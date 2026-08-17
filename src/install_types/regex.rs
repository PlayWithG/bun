//! Type-erased handle to a compiled `JSC::Yarr::RegularExpression`.
//!
//! `bun_jsc` (which owns the Yarr FFI) lives in a higher tier than the crates
//! that need to match user-supplied patterns without a VM (`.npmrc`
//! hoist patterns here, `--mangle-props` in the bundler). That edge is broken
//! with link-time `extern "Rust"` symbols whose bodies are defined
//! `#[no_mangle]` in `bun_jsc::regular_expression`. This module is the single
//! declaration site for those symbols.

use core::ptr::NonNull;

unsafe extern "Rust" {
    /// `None` if the pattern or the flags are invalid. Performs
    /// `jsc::initialize(false)` lazily.
    fn __bun_regex_compile(pattern: &[u8], js_flags: &[u8]) -> Option<NonNull<()>>;
    fn __bun_regex_matches(regex: NonNull<()>, input: &[u8]) -> bool;
    fn __bun_regex_drop(regex: NonNull<()>);
}

/// Owned, compiled regex. Matching mutates state inside the Yarr object (the
/// handle is `!Sync` for that reason), so compile one per thread instead of
/// sharing; compiling is cheap.
// FORWARD_DECL(b0): bun_jsc::RegularExpression — stored as raw NonNull<()>
// (NOT Box<ZST>: a zero-sized opaque Box is a dangling sentinel that would
// leak the real JSC allocation and skip its destructor).
pub struct RegularExpression(NonNull<()>);

impl RegularExpression {
    /// Compiles `pattern` (UTF-8) with JavaScript `RegExp` flags (`js_flags`,
    /// e.g. `b"i"`; see `bun_jsc::regular_expression::Flags::bits_from_js_flags`
    /// for which flags are honored). Returns `None` if either is invalid.
    #[inline]
    pub fn compile(pattern: &[u8], js_flags: &[u8]) -> Option<Self> {
        // SAFETY: link-time extern; both arguments are only borrowed for the call.
        unsafe { __bun_regex_compile(pattern, js_flags) }.map(Self)
    }

    /// Unanchored search, like `RegExp.prototype.test` on a regex without the
    /// `g`/`y` flags.
    #[inline]
    pub fn matches(&self, input: &[u8]) -> bool {
        // SAFETY: self.0 was produced by `__bun_regex_compile` and is live until Drop.
        unsafe { __bun_regex_matches(self.0, input) }
    }
}

impl Drop for RegularExpression {
    fn drop(&mut self) {
        // SAFETY: self.0 was produced by `__bun_regex_compile`; runs the JSC destructor + free.
        unsafe { __bun_regex_drop(self.0) }
    }
}
