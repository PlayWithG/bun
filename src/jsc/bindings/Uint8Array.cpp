#include "root.h"

#include "JavaScriptCore/JSArrayBuffer.h"
#include "JavaScriptCore/TypedArrayType.h"

extern "C" void Bun__freeDefaultAllocator(void* ptr);

namespace Bun {

static void freeDefaultAllocator(void* ptr)
{
    // These callbacks only receive ownership of memory allocated by
    // bun.default_allocator. The Zig bridge selects mimalloc or libc for the
    // current build; C++ must not duplicate that build-time assumption.
    Bun__freeDefaultAllocator(ptr);
}

extern "C" JSC::EncodedJSValue JSUint8Array__fromDefaultAllocator(JSC::JSGlobalObject* lexicalGlobalObject, uint8_t* ptr, size_t length)
{
    JSC::JSUint8Array* uint8Array;

    if (length > 0) [[likely]] {
        auto buffer = ArrayBuffer::createFromBytes({ ptr, length }, createSharedTask<void(void*)>([](void* p) {
            freeDefaultAllocator(p);
        }));

        uint8Array = JSC::JSUint8Array::create(lexicalGlobalObject, lexicalGlobalObject->typedArrayStructureWithTypedArrayType<JSC::TypeUint8>(), WTF::move(buffer), 0, length);
    } else {
        uint8Array = JSC::JSUint8Array::create(lexicalGlobalObject, lexicalGlobalObject->typedArrayStructureWithTypedArrayType<JSC::TypeUint8>(), 0);
    }

    return JSC::JSValue::encode(uint8Array);
}

extern "C" JSC::EncodedJSValue JSArrayBuffer__fromDefaultAllocator(JSC::JSGlobalObject* lexicalGlobalObject, uint8_t* ptr, size_t length)
{

    RefPtr<ArrayBuffer> buffer;

    if (length > 0) [[likely]] {
        buffer = ArrayBuffer::createFromBytes({ ptr, length }, createSharedTask<void(void*)>([](void* p) {
            freeDefaultAllocator(p);
        }));
    } else {
        buffer = ArrayBuffer::create(0, 1);
    }

    auto arrayBuffer = JSC::JSArrayBuffer::create(lexicalGlobalObject->vm(), lexicalGlobalObject->arrayBufferStructure(), WTF::move(buffer));
    return JSC::JSValue::encode(arrayBuffer);
}

}
