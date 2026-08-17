#include "root.h"
#include "headers-handwritten.h"
#include <JavaScriptCore/RegularExpression.h>
#include <JavaScriptCore/Options.h>
#include <JavaScriptCore/Yarr.h>
#include <JavaScriptCore/YarrFlags.h>
#include <JavaScriptCore/YarrInterpreter.h>
#include <JavaScriptCore/YarrPattern.h>
#include <wtf/BumpPointerAllocator.h>

using namespace JSC;
using namespace JSC::Yarr;

extern "C" RegularExpression* Yarr__RegularExpression__init(BunString pattern, uint16_t flags)
{
    // TODO: Remove this, we technically are accessing options before we finalize them.
    // This means you cannot use BUN_JSC_dumpCompiledRegExpPatterns on the flag passed to `bun test -t`
    // NOLINTBEGIN
    Options::AllowUnfinalizedAccessScope scope {};
    // NOLINTEND
    return new RegularExpression(pattern.toWTFString(BunString::ZeroCopy), OptionSet<Flags>(static_cast<Flags>(flags)));
}
extern "C" void Yarr__RegularExpression__deinit(RegularExpression* re)
{
    delete re;
}
extern "C" bool Yarr__RegularExpression__isValid(RegularExpression* re)
{
    return re->isValid();
}
extern "C" int Yarr__RegularExpression__matchedLength(RegularExpression* re)
{
    return re->matchedLength();
}
extern "C" int Yarr__RegularExpression__searchRev(RegularExpression* re, BunString string)
{
    return re->searchRev(string.toWTFString(BunString::ZeroCopy));
}
// extern "C" int Yarr__RegularExpression__match(RegularExpression* re, BunString string, int32_t start, int32_t* matchLength)
// {
//     return re->match(string.toWTFString(BunString::ZeroCopy), start, matchLength);
// }
extern "C" int Yarr__RegularExpression__matches(RegularExpression* re, BunString string)
{
    return re->match(string.toWTFString(BunString::ZeroCopy), 0, 0);
}

namespace Bun {

// A user-supplied `RegExp` (source + flags) compiled for `regexp.test(input)`
// style matching without a VM. Unlike `Yarr::RegularExpression` above, which
// only supports the i, m and v flags, this accepts every flag a RegExp can
// have, so a RegExp taken from JavaScript always compiles with the same
// meaning it had there. Not safe to use from more than one thread at a time.
class RegExpMatcher {
public:
    static RegExpMatcher* create(BunString pattern, BunString flagsString)
    {
        auto flags = parseFlags(flagsString.toWTFString(BunString::ZeroCopy));
        if (!flags)
            return nullptr;

        // Yarr reads JSC::Options (e.g. dumpCompiledRegExpPatterns); this may run
        // before the runtime has finalized them, like Yarr__RegularExpression__init.
        // NOLINTBEGIN
        Options::AllowUnfinalizedAccessScope scope {};
        // NOLINTEND

        auto* matcher = new RegExpMatcher();
        ErrorCode error = ErrorCode::NoError;
        YarrPattern yarrPattern(pattern.toWTFString(BunString::NonNull), *flags, error);
        if (!hasError(error))
            matcher->m_bytecode = byteCompile(yarrPattern, &matcher->m_allocator, error);
        if (hasError(error) || !matcher->m_bytecode) {
            delete matcher;
            return nullptr;
        }
        return matcher;
    }

    bool matches(BunString input)
    {
        WTF::String string = input.toWTFString(BunString::NonNull);
        // The interpreter expects the start offset of every subpattern to be
        // initialized to "no match".
        Vector<unsigned, 32> offsets;
        offsets.fill(offsetNoMatch, m_bytecode->m_offsetsSize);
        return interpret(m_bytecode.get(), string, 0, offsets.mutableSpan().data()) != offsetNoMatch;
    }

private:
    RegExpMatcher() = default;

    // Declared before the bytecode, which is allocated out of it, so that it
    // outlives the bytecode during destruction.
    BumpPointerAllocator m_allocator;
    std::unique_ptr<BytecodePattern> m_bytecode;
};

} // namespace Bun

extern "C" Bun::RegExpMatcher* Bun__RegExpMatcher__create(BunString pattern, BunString flags)
{
    return Bun::RegExpMatcher::create(pattern, flags);
}
extern "C" bool Bun__RegExpMatcher__matches(Bun::RegExpMatcher* matcher, BunString input)
{
    return matcher->matches(input);
}
extern "C" void Bun__RegExpMatcher__destroy(Bun::RegExpMatcher* matcher)
{
    delete matcher;
}
