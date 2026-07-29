#include <pebble.h>

// The stock machine gets a 32K static block, which cannot hold a multi-kilobyte
// reply plus the array of wrapped lines drawn from it — XS aborts with "memory
// full". Asking for more than the static block makes the runtime allocate from
// the app heap instead, and it does not grow afterwards, so leave headroom.
#define JS_STACK_BYTES (6 * 1024)
#define JS_SLOT_BYTES (24 * 1024)
#define JS_CHUNK_BYTES (40 * 1024)

int main(void) {
  Window *w = window_create();
  window_stack_push(w, true);

  ModdableCreationRecord cr = {
    .recordSize = sizeof(cr),
    .stack = JS_STACK_BYTES,
    .slot = JS_SLOT_BYTES,
    .chunk = JS_CHUNK_BYTES,
#ifdef PBL_DEBUG
    // Built with `pebble build --debug`: enable the xsbug JavaScript debugger.
    .flags = kModdableCreationFlagDebug,
#endif
  };
  moddable_createMachine(&cr);

  window_destroy(w);
}
