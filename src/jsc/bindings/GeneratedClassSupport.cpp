#include "GeneratedClassSupport.h"
#include "ErrorCode.h"

namespace Bun {

NEVER_INLINE JSC::Structure* createClassStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSValue prototype, JSC::TypeInfo typeInfo, const JSC::ClassInfo* classInfo)
{
    return JSC::Structure::create(vm, globalObject, prototype, typeInfo, classInfo);
}

NEVER_INLINE JSC::Structure* createPrototypeStructure(JSC::VM& vm, JSC::JSGlobalObject* globalObject, JSC::JSObject* basePrototype, const JSC::ClassInfo* classInfo)
{
    auto* structure = JSC::Structure::create(vm, globalObject, basePrototype, JSC::TypeInfo(JSC::ObjectType, JSC::JSNonFinalObject::StructureFlags), classInfo);
    structure->setMayBePrototype(true);
    return structure;
}

NEVER_INLINE void reifyStaticProperties(JSC::VM& vm, const JSC::ClassInfo* classInfo, std::span<const JSC::HashTableValue> values, JSC::JSObject& thisObject)
{
    JSC::reifyStaticProperties(vm, classInfo, values, thisObject);
}

NEVER_INLINE void putToStringTag(JSC::VM& vm, JSC::JSObject& object, WTF::ASCIILiteral className)
{
    object.putDirectWithoutTransition(vm, vm.propertyNames->toStringTagSymbol, JSC::jsNontrivialString(vm, className), JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::ReadOnly);
}

NEVER_INLINE void putConstructorPrototype(JSC::VM& vm, JSC::JSObject& constructor, JSC::JSObject* prototype)
{
    constructor.putDirectWithoutTransition(vm, vm.propertyNames->prototype, prototype, JSC::PropertyAttribute::DontEnum | JSC::PropertyAttribute::DontDelete | JSC::PropertyAttribute::ReadOnly);
}

NEVER_INLINE void analyzeCachedValueEdge(JSC::JSCell* cell, JSC::HeapAnalyzer& analyzer, const JSC::WriteBarrier<JSC::Unknown>& slot, WTF::ASCIILiteral name)
{
    JSC::JSValue value = slot.get();
    if (!value || !value.isCell())
        return;
    auto& vm = cell->vm();
    const JSC::Identifier& id = JSC::Identifier::fromString(vm, name);
    analyzer.analyzePropertyNameEdge(cell, value.asCell(), id.impl());
}

NEVER_INLINE JSC::EncodedJSValue throwConstructorCannotBeCalled(JSC::JSGlobalObject* globalObject, WTF::ASCIILiteral message)
{
    auto& vm = globalObject->vm();
    auto scope = DECLARE_THROW_SCOPE(vm);
    Bun::throwError(globalObject, scope, Bun::ErrorCode::ERR_ILLEGAL_CONSTRUCTOR, message);
    return JSC::JSValue::encode(JSC::jsUndefined());
}

} // namespace Bun
