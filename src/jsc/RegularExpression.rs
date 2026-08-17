use bun_core::String as BunString;

bun_opaque::opaque_ffi! {
    /// Opaque FFI handle for `JSC::Yarr::RegularExpression`.
    pub struct RegularExpression;
}

#[repr(u16)]
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum Flags {
    None = 0,

    HasIndices = 1 << 0,
    Global = 1 << 1,
    IgnoreCase = 1 << 2,
    Multiline = 1 << 3,
    DotAll = 1 << 4,
    Unicode = 1 << 5,
    UnicodeSets = 1 << 6,
    Sticky = 1 << 7,
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
pub enum RegularExpressionError {
    #[error("InvalidRegExp")]
    InvalidRegExp,
}

// `RegularExpression` is an opaque `UnsafeCell`-backed ZST handle, so
// `&RegularExpression` is ABI-identical to a non-null `*const` and C++ mutating
// internal Yarr state through it is interior mutation invisible to Rust. The
// query/compile shims are therefore declared `safe fn`; only `deinit` (which
// frees the allocation) keeps a raw `*mut` and stays `unsafe`.
unsafe extern "C" {
    safe fn Yarr__RegularExpression__init(pattern: BunString, flags: u16)
    -> *mut RegularExpression;
    fn Yarr__RegularExpression__deinit(pattern: *mut RegularExpression);
    safe fn Yarr__RegularExpression__isValid(this: &RegularExpression) -> bool;
    safe fn Yarr__RegularExpression__matches(this: &RegularExpression, string: BunString) -> i32;
}

impl Flags {
    /// Converts a JavaScript `RegExp.prototype.flags` string into the subset of
    /// flags `JSC::Yarr::RegularExpression` supports (`i`, `m`, `v`). `u` is
    /// compiled as `v`; `d`, `g`, `s` and `y` do not change whether a string
    /// matches, so they are ignored. Unknown letters are an error.
    pub fn bits_from_js_flags(flags: &[u8]) -> Result<u16, RegularExpressionError> {
        let mut bits: u16 = 0;
        for &flag in flags {
            bits |= match flag {
                b'i' => Flags::IgnoreCase as u16,
                b'm' => Flags::Multiline as u16,
                b'u' | b'v' => Flags::UnicodeSets as u16,
                b'd' | b'g' | b's' | b'y' => 0,
                _ => return Err(RegularExpressionError::InvalidRegExp),
            };
        }
        Ok(bits)
    }
}

impl RegularExpression {
    #[inline]
    pub fn init(
        pattern: BunString,
        flags: Flags,
    ) -> Result<*mut RegularExpression, RegularExpressionError> {
        Self::init_with_flag_bits(pattern, flags as u16)
    }

    /// `flags` is a combination of [`Flags`] bits (see [`Flags::bits_from_js_flags`]).
    pub fn init_with_flag_bits(
        pattern: BunString,
        flags: u16,
    ) -> Result<*mut RegularExpression, RegularExpressionError> {
        let regex = Yarr__RegularExpression__init(pattern, flags);
        // `RegularExpression` is an `opaque_ffi!` ZST handle; `opaque_mut` is
        // the centralised non-null-ZST deref proof (panics on null, which
        // `Yarr__RegularExpression__init` never returns).
        if !RegularExpression::opaque_mut(regex).is_valid() {
            // SAFETY: `regex` is a valid live Yarr handle we just allocated; consumed here.
            unsafe { Self::destroy(regex) };
            return Err(RegularExpressionError::InvalidRegExp);
        }
        Ok(regex)
    }

    #[inline]
    pub(crate) fn is_valid(&mut self) -> bool {
        Yarr__RegularExpression__isValid(self)
    }

    // Reserving `match` for a full match result.
    // #[inline]
    // pub fn r#match(&mut self, str: BunString, start_from: i32) -> MatchResult {
    // }

    /// Simple boolean matcher
    #[inline]
    pub fn matches(&mut self, str: BunString) -> bool {
        Yarr__RegularExpression__matches(self, str) >= 0
    }

    /// Destroys the FFI-allocated handle. Caller must not use `this` afterwards.
    #[inline]
    pub(crate) unsafe fn destroy(this: *mut Self) {
        // SAFETY: `this` is a valid live Yarr RegularExpression handle; consumed here.
        unsafe { Yarr__RegularExpression__deinit(this) }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// `bun_install_types::regex::RegularExpression` extern impls (used by
// `PnpmMatcher` and the bundler's `--mangle-props`).
//
// Those lower-tier crates cannot name `jsc::RegularExpression`.
// The bodies live here as `#[no_mangle]` Rust-ABI
// fns, declared `extern "Rust"` on the low-tier side; link-time resolved.
// ──────────────────────────────────────────────────────────────────────────

/// `js_flags` is a JavaScript `RegExp` flags string (see
/// [`Flags::bits_from_js_flags`]). Returns `None` if the pattern or the flags
/// are invalid.
#[unsafe(no_mangle)]
fn __bun_regex_compile(pattern: &[u8], js_flags: &[u8]) -> Option<core::ptr::NonNull<()>> {
    let flags = Flags::bits_from_js_flags(js_flags).ok()?;
    // Initialize JSC before first compile (idempotent).
    crate::initialize(false);
    // Yarr copies what it needs out of the pattern while compiling, so a
    // borrowed view of the bytes is enough.
    match RegularExpression::init_with_flag_bits(BunString::from_bytes(pattern), flags) {
        Ok(r) => core::ptr::NonNull::new(r.cast()),
        Err(_) => None,
    }
}

#[unsafe(no_mangle)]
fn __bun_regex_matches(regex: core::ptr::NonNull<()>, input: &[u8]) -> bool {
    // `RegularExpression` is an `opaque_ffi!` ZST handle; `opaque_mut` is the
    // centralised non-null deref proof. `regex` was produced by
    // `__bun_regex_compile` and remains live until `__bun_regex_drop`.
    RegularExpression::opaque_mut(regex.as_ptr().cast()).matches(BunString::from_bytes(input))
}

#[unsafe(no_mangle)]
fn __bun_regex_drop(regex: core::ptr::NonNull<()>) {
    // SAFETY: `regex` was produced by `__bun_regex_compile`; consumed here.
    unsafe { RegularExpression::destroy(regex.as_ptr().cast()) }
}
