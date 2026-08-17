//! The parser half of `--mangle-props` (property name mangling).
//!
//! Every property name written as syntax goes through [`P::is_mangled_prop`]:
//! member accesses (`e_dot`), keys of object literals, classes, binding
//! patterns and JSX attributes (`property_key_for_name`), and, when
//! `mangle_quoted` is on or the literal is annotated with `/* @__KEY__ */`,
//! string literals in property positions (`mangle_string_as_prop`).
//!
//! A mangled name is represented by a `Kind::MangledProp` symbol, one per name
//! per file, referenced from `E::NameOfSymbol` nodes. Nothing is renamed here:
//! the linker merges the symbols of all files and assigns the final names
//! (`LinkerContext::mangle_props`); `js_printer::print_ast` does the same for a
//! single file when not bundling. Until then the symbol's `original_name` is
//! the property name, so printing an unassigned symbol reproduces the input.
//!
//! Every name that is seen but *not* mangled is recorded in `reserved_props`,
//! so the generated names can never collide with a property the program still
//! uses under its real name (`{ foo_: 1, a: 2 }` must not become `{ a: 1, a: 2 }`).

use crate::p::P;
use bun_ast::{self as js_ast, E, Expr, ExprData, Ref};

impl<'a, const TYPESCRIPT: bool, const SCAN_ONLY: bool> P<'a, TYPESCRIPT, SCAN_ONLY> {
    #[inline]
    pub(crate) fn is_mangling_props(&self) -> bool {
        self.options.mangle_props.is_some()
    }

    /// Whether the property `name` is renamed in this build. A name that is not
    /// renamed becomes reserved.
    pub(crate) fn is_mangled_prop(&mut self, name: &'a [u8]) -> bool {
        let Some(mangler) = self.options.mangle_props else {
            return false;
        };
        // The regex only runs once per distinct name per file: `mangled_props`
        // remembers the names it accepted, `unmangled_props` the ones it rejected.
        if self.mangled_props.contains(name) {
            return true;
        }
        if self.unmangled_props.contains(&name) {
            return false;
        }
        if mangler.should_mangle(name) {
            return true;
        }
        self.unmangled_props.insert(name, ());
        self.reserved_props.insert(name, ());
        false
    }

    /// Records that `name` appears in the output as a property name, so no
    /// mangled property may be given that name. This includes names that are
    /// mangled elsewhere but quoted here: `x.foo_` may become `x.a` while
    /// `x["foo_"]` stays, and then no other property may become `foo_`.
    pub(crate) fn reserve_prop(&mut self, name: &[u8]) {
        if self.is_mangling_props() {
            self.reserved_props.insert(name, ());
        }
    }

    /// The symbol standing in for the mangled property `name` in this file,
    /// created on first use. Each call counts one use: the linker adds up the
    /// counts of every file's symbol for the name, and the most used names get
    /// the shortest replacements.
    pub(crate) fn symbol_for_mangled_prop(&mut self, name: &'a [u8]) -> Ref {
        let ref_ = match self.mangled_props.get(name) {
            Some(ref_) => *ref_,
            None => {
                let ref_ = self.new_symbol(js_ast::symbol::Kind::MangledProp, name);
                self.mangled_props.insert(name, ref_);
                ref_
            }
        };

        if !self.is_control_flow_dead && !self.is_revisit_for_substitution {
            self.symbols[ref_.inner_index() as usize].use_count_estimate += 1;
        }

        ref_
    }

    /// `Some(E::NameOfSymbol)` if the property `name` is mangled.
    pub(crate) fn mangled_prop_expr(
        &mut self,
        name: &'a [u8],
        loc: bun_ast::Loc,
        has_property_key_comment: bool,
    ) -> Option<Expr> {
        if !self.is_mangled_prop(name) {
            return None;
        }
        let ref_ = self.symbol_for_mangled_prop(name);
        Some(self.new_expr(
            E::NameOfSymbol {
                ref_,
                has_property_key_comment,
            },
            loc,
        ))
    }

    /// The key expression for a property written as a bare name: `{ name: 1 }`,
    /// `class { name() {} }`, `let { name } = x`, `<a name="" />`.
    pub(crate) fn property_key_for_name(&mut self, name: &'a [u8], loc: bun_ast::Loc) -> Expr {
        if self.is_mangling_props() {
            if let Some(key) = self.mangled_prop_expr(name, loc, false) {
                return key;
            }
        }
        self.new_expr(E::EString::init(name), loc)
    }

    /// A string literal whose value names a property: a quoted key, the index
    /// of `a["name"]`, a computed key, or the left side of `"name" in a`. With
    /// `mangle_quoted` it is mangled like a bare name would be; otherwise the
    /// name is reserved since it stays in the output as written. Expressions
    /// other than string literals are returned unchanged.
    pub(crate) fn mangle_string_as_prop(&mut self, expr: Expr) -> Expr {
        let Some(mangler) = self.options.mangle_props else {
            return expr;
        };
        let ExprData::EString(mut string) = expr.data else {
            return expr;
        };
        let name: &'a [u8] = string.slice(self.arena);
        if mangler.mangle_quoted {
            if let Some(mangled) = self.mangled_prop_expr(name, expr.loc, false) {
                return mangled;
            }
        } else {
            self.reserve_prop(name);
        }
        expr
    }

    /// `/* @__KEY__ */ "name"` marks a string literal anywhere as a property
    /// name, so that code like `obj[/* @__KEY__ */ "name_"]` or
    /// `const key = /* @__KEY__ */ "name_"` stays in sync with the mangled
    /// property even without `mangle_quoted`.
    pub(crate) fn mangle_property_key_comment_string(&mut self, expr: Expr) -> Expr {
        let ExprData::EString(mut string) = expr.data else {
            return expr;
        };
        let name: &'a [u8] = string.slice(self.arena);
        self.mangled_prop_expr(name, expr.loc, true).unwrap_or(expr)
    }

    /// Visit-time counterpart of `property_key_for_name` for member accesses:
    /// `a.name` becomes `a[E::NameOfSymbol]`, which the printer prints as a
    /// member access again once the name is known. Called once the usual
    /// rewrites of a member access (defines, import items, enum inlining) have
    /// declined to replace it, so those take precedence over mangling.
    pub(crate) fn mangled_dot_to_index(&mut self, expr: Expr) -> Option<Expr> {
        let dot = expr.data.e_dot()?;
        let index = self.mangled_prop_expr(dot.name.slice(), dot.name_loc, false)?;
        Some(self.new_expr(
            E::Index {
                target: dot.target,
                index,
                optional_chain: dot.optional_chain,
            },
            expr.loc,
        ))
    }

    /// Builds the member access `target.name` for code the parser generates
    /// from a user-written name after the visit pass has already run over the
    /// surrounding code (TypeScript parameter properties, namespace exports,
    /// enum members). Such accesses never reach `e_dot`, so the mangling
    /// decision is made here: the result is `target[E::NameOfSymbol]` when the
    /// name is mangled and a plain `E::Dot` otherwise. User code reading the
    /// same property goes through `e_dot`, so both sides agree.
    pub(crate) fn dot_or_mangled_prop(
        &mut self,
        target: Expr,
        name: &'a [u8],
        name_loc: bun_ast::Loc,
        loc: bun_ast::Loc,
    ) -> Expr {
        if self.is_mangling_props() {
            if let Some(index) = self.mangled_prop_expr(name, name_loc, false) {
                return self.new_expr(
                    E::Index {
                        target,
                        index,
                        optional_chain: None,
                    },
                    loc,
                );
            }
        }
        self.new_expr(
            E::Dot {
                target,
                name: name.into(),
                name_loc,
                ..Default::default()
            },
            loc,
        )
    }
}
