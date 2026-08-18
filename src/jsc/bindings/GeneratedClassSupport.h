#pragma once

#include "root.h"
#include <JavaScriptCore/HeapAnalyzer.h>
#include <JavaScriptCore/InternalFunction.h>
#include <JavaScriptCore/Lookup.h>

// Shared cold bodies for the per-class boilerplate emitted by
// src/codegen/generate-classes.ts; the per-class copies differed only by immediates.
namespace Bun {

NEVER_INLINE JSC::Structure* createClassStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSValue prototype, JSC::TypeInfo, const JSC::ClassInfo*);
NEVER_INLINE JSC::Structure* createPrototypeStructure(JSC::VM&, JSC::JSGlobalObject*, JSC::JSObject* basePrototype, const JSC::ClassInfo*);
NEVER_INLINE void reifyStaticProperties(JSC::VM&, const JSC::ClassInfo*, std::span<const JSC::HashTableValue>, JSC::JSObject&);
NEVER_INLINE void putToStringTag(JSC::VM&, JSC::JSObject&, WTF::ASCIILiteral className);
NEVER_INLINE void putConstructorPrototype(JSC::VM&, JSC::JSObject& constructor, JSC::JSObject* prototype);
NEVER_INLINE void analyzeCachedValueEdge(JSC::JSCell*, JSC::HeapAnalyzer&, const JSC::WriteBarrier<JSC::Unknown>&, WTF::ASCIILiteral name);
NEVER_INLINE JSC::EncodedJSValue throwConstructorCannotBeCalled(JSC::JSGlobalObject*, WTF::ASCIILiteral message);

} // namespace Bun
