try {
  this["Module"] = Module;
} catch (e) {
  this["Module"] = Module = {};
}

var ENVIRONMENT_IS_NODE = typeof process === "object";

var ENVIRONMENT_IS_WEB = typeof window === "object";

var ENVIRONMENT_IS_WORKER = typeof importScripts === "function";

var ENVIRONMENT_IS_SHELL = !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_NODE && !ENVIRONMENT_IS_WORKER;

if (ENVIRONMENT_IS_NODE) {
  Module["print"] = (function(x) {
    process["stdout"].write(x + "\n");
  });
  Module["printErr"] = (function(x) {
    process["stderr"].write(x + "\n");
  });
  var nodeFS = require("fs");
  var nodePath = require("path");
  Module["read"] = (function(filename) {
    filename = nodePath["normalize"](filename);
    var ret = nodeFS["readFileSync"](filename).toString();
    if (!ret && filename != nodePath["resolve"](filename)) {
      filename = path.join(__dirname, "..", "src", filename);
      ret = nodeFS["readFileSync"](filename).toString();
    }
    return ret;
  });
  Module["load"] = (function(f) {
    globalEval(read(f));
  });
  if (!Module["arguments"]) {
    Module["arguments"] = process["argv"].slice(2);
  }
} else if (ENVIRONMENT_IS_SHELL) {
  Module["print"] = print;
  Module["printErr"] = printErr;
  if (typeof read != "undefined") {
    Module["read"] = read;
  } else {
    Module["read"] = (function(f) {
      snarf(f);
    });
  }
  if (!Module["arguments"]) {
    if (typeof scriptArgs != "undefined") {
      Module["arguments"] = scriptArgs;
    } else if (typeof arguments != "undefined") {
      Module["arguments"] = arguments;
    }
  }
} else if (ENVIRONMENT_IS_WEB) {
  if (!Module["print"]) {
    Module["print"] = (function(x) {
      console.log(x);
    });
  }
  if (!Module["printErr"]) {
    Module["printErr"] = (function(x) {
      console.log(x);
    });
  }
  Module["read"] = (function(url) {
    var xhr = new XMLHttpRequest;
    xhr.open("GET", url, false);
    xhr.send(null);
    return xhr.responseText;
  });
  if (!Module["arguments"]) {
    if (typeof arguments != "undefined") {
      Module["arguments"] = arguments;
    }
  }
} else if (ENVIRONMENT_IS_WORKER) {
  Module["load"] = importScripts;
} else {
  throw "Unknown runtime environment. Where are we?";
}

function globalEval(x) {
  eval.call(null, x);
}

if (!Module["load"] == "undefined" && Module["read"]) {
  Module["load"] = (function(f) {
    globalEval(Module["read"](f));
  });
}

if (!Module["printErr"]) {
  Module["printErr"] = (function() {});
}

if (!Module["print"]) {
  Module["print"] = Module["printErr"];
}

if (!Module["arguments"]) {
  Module["arguments"] = [];
}

Module.print = Module["print"];

Module.printErr = Module["printErr"];

if (!Module["preRun"]) Module["preRun"] = [];

if (!Module["postRun"]) Module["postRun"] = [];

var Runtime = {
  stackSave: (function() {
    return STACKTOP;
  }),
  stackRestore: (function(stackTop) {
    STACKTOP = stackTop;
  }),
  forceAlign: (function(target, quantum) {
    quantum = quantum || 4;
    if (quantum == 1) return target;
    if (isNumber(target) && isNumber(quantum)) {
      return Math.ceil(target / quantum) * quantum;
    } else if (isNumber(quantum) && isPowerOfTwo(quantum)) {
      var logg = log2(quantum);
      return "((((" + target + ")+" + (quantum - 1) + ")>>" + logg + ")<<" + logg + ")";
    }
    return "Math.ceil((" + target + ")/" + quantum + ")*" + quantum;
  }),
  isNumberType: (function(type) {
    return type in Runtime.INT_TYPES || type in Runtime.FLOAT_TYPES;
  }),
  isPointerType: function isPointerType(type) {
    return type[type.length - 1] == "*";
  },
  isStructType: function isStructType(type) {
    if (isPointerType(type)) return false;
    if (/^\[\d+\ x\ (.*)\]/.test(type)) return true;
    if (/<?{ ?[^}]* ?}>?/.test(type)) return true;
    return type[0] == "%";
  },
  INT_TYPES: {
    "i1": 0,
    "i8": 0,
    "i16": 0,
    "i32": 0,
    "i64": 0
  },
  FLOAT_TYPES: {
    "float": 0,
    "double": 0
  },
  bitshift64: (function(low, high, op, bits) {
    var ander = Math.pow(2, bits) - 1;
    if (bits < 32) {
      switch (op) {
       case "shl":
        return [ low << bits, high << bits | (low & ander << 32 - bits) >>> 32 - bits ];
       case "ashr":
        return [ (low >>> bits | (high & ander) << 32 - bits) >> 0 >>> 0, high >> bits >>> 0 ];
       case "lshr":
        return [ (low >>> bits | (high & ander) << 32 - bits) >>> 0, high >>> bits ];
      }
    } else if (bits == 32) {
      switch (op) {
       case "shl":
        return [ 0, low ];
       case "ashr":
        return [ high, (high | 0) < 0 ? ander : 0 ];
       case "lshr":
        return [ high, 0 ];
      }
    } else {
      switch (op) {
       case "shl":
        return [ 0, low << bits - 32 ];
       case "ashr":
        return [ high >> bits - 32 >>> 0, (high | 0) < 0 ? ander : 0 ];
       case "lshr":
        return [ high >>> bits - 32, 0 ];
      }
    }
    abort("unknown bitshift64 op: " + [ value, op, bits ]);
  }),
  or64: (function(x, y) {
    var l = x | 0 | (y | 0);
    var h = (Math.round(x / 4294967296) | Math.round(y / 4294967296)) * 4294967296;
    return l + h;
  }),
  and64: (function(x, y) {
    var l = (x | 0) & (y | 0);
    var h = (Math.round(x / 4294967296) & Math.round(y / 4294967296)) * 4294967296;
    return l + h;
  }),
  xor64: (function(x, y) {
    var l = (x | 0) ^ (y | 0);
    var h = (Math.round(x / 4294967296) ^ Math.round(y / 4294967296)) * 4294967296;
    return l + h;
  }),
  getNativeTypeSize: (function(type, quantumSize) {
    if (Runtime.QUANTUM_SIZE == 1) return 1;
    var size = {
      "%i1": 1,
      "%i8": 1,
      "%i16": 2,
      "%i32": 4,
      "%i64": 8,
      "%float": 4,
      "%double": 8
    }["%" + type];
    if (!size) {
      if (type[type.length - 1] == "*") {
        size = Runtime.QUANTUM_SIZE;
      } else if (type[0] == "i") {
        var bits = parseInt(type.substr(1));
        assert(bits % 8 == 0);
        size = bits / 8;
      }
    }
    return size;
  }),
  getNativeFieldSize: (function(type) {
    return Math.max(Runtime.getNativeTypeSize(type), Runtime.QUANTUM_SIZE);
  }),
  dedup: function dedup(items, ident) {
    var seen = {};
    if (ident) {
      return items.filter((function(item) {
        if (seen[item[ident]]) return false;
        seen[item[ident]] = true;
        return true;
      }));
    } else {
      return items.filter((function(item) {
        if (seen[item]) return false;
        seen[item] = true;
        return true;
      }));
    }
  },
  set: function set() {
    var args = typeof arguments[0] === "object" ? arguments[0] : arguments;
    var ret = {};
    for (var i = 0; i < args.length; i++) {
      ret[args[i]] = 0;
    }
    return ret;
  },
  calculateStructAlignment: function calculateStructAlignment(type) {
    type.flatSize = 0;
    type.alignSize = 0;
    var diffs = [];
    var prev = -1;
    type.flatIndexes = type.fields.map((function(field) {
      var size, alignSize;
      if (Runtime.isNumberType(field) || Runtime.isPointerType(field)) {
        size = Runtime.getNativeTypeSize(field);
        alignSize = size;
      } else if (Runtime.isStructType(field)) {
        size = Types.types[field].flatSize;
        alignSize = Types.types[field].alignSize;
      } else {
        throw "Unclear type in struct: " + field + ", in " + type.name_ + " :: " + dump(Types.types[type.name_]);
      }
      alignSize = type.packed ? 1 : Math.min(alignSize, Runtime.QUANTUM_SIZE);
      type.alignSize = Math.max(type.alignSize, alignSize);
      var curr = Runtime.alignMemory(type.flatSize, alignSize);
      type.flatSize = curr + size;
      if (prev >= 0) {
        diffs.push(curr - prev);
      }
      prev = curr;
      return curr;
    }));
    type.flatSize = Runtime.alignMemory(type.flatSize, type.alignSize);
    if (diffs.length == 0) {
      type.flatFactor = type.flatSize;
    } else if (Runtime.dedup(diffs).length == 1) {
      type.flatFactor = diffs[0];
    }
    type.needsFlattening = type.flatFactor != 1;
    return type.flatIndexes;
  },
  generateStructInfo: (function(struct, typeName, offset) {
    var type, alignment;
    if (typeName) {
      offset = offset || 0;
      type = (typeof Types === "undefined" ? Runtime.typeInfo : Types.types)[typeName];
      if (!type) return null;
      assert(type.fields.length === struct.length, "Number of named fields must match the type for " + typeName);
      alignment = type.flatIndexes;
    } else {
      var type = {
        fields: struct.map((function(item) {
          return item[0];
        }))
      };
      alignment = Runtime.calculateStructAlignment(type);
    }
    var ret = {
      __size__: type.flatSize
    };
    if (typeName) {
      struct.forEach((function(item, i) {
        if (typeof item === "string") {
          ret[item] = alignment[i] + offset;
        } else {
          var key;
          for (var k in item) key = k;
          ret[key] = Runtime.generateStructInfo(item[key], type.fields[i], alignment[i]);
        }
      }));
    } else {
      struct.forEach((function(item, i) {
        ret[item[1]] = alignment[i];
      }));
    }
    return ret;
  }),
  addFunction: (function(func) {
    var ret = FUNCTION_TABLE.length;
    FUNCTION_TABLE.push(func);
    FUNCTION_TABLE.push(0);
    return ret;
  }),
  warnOnce: (function(text) {
    if (!Runtime.warnOnce.shown) Runtime.warnOnce.shown = {};
    if (!Runtime.warnOnce.shown[text]) {
      Runtime.warnOnce.shown[text] = 1;
      Module.printErr(text);
    }
  }),
  funcWrappers: {},
  getFuncWrapper: (function(func) {
    if (!Runtime.funcWrappers[func]) {
      Runtime.funcWrappers[func] = (function() {
        FUNCTION_TABLE[func].apply(null, arguments);
      });
    }
    return Runtime.funcWrappers[func];
  }),
  stackAlloc: function stackAlloc(size) {
    var ret = STACKTOP;
    STACKTOP += size;
    STACKTOP = STACKTOP + 3 >> 2 << 2;
    assert(STACKTOP < STACK_ROOT + STACK_MAX, "Ran out of stack");
    return ret;
  },
  staticAlloc: function staticAlloc(size) {
    var ret = STATICTOP;
    STATICTOP += size;
    STATICTOP = STATICTOP + 3 >> 2 << 2;
    if (STATICTOP >= TOTAL_MEMORY) enlargeMemory();
    return ret;
  },
  alignMemory: function alignMemory(size, quantum) {
    var ret = size = Math.ceil(size / (quantum ? quantum : 4)) * (quantum ? quantum : 4);
    return ret;
  },
  makeBigInt: function makeBigInt(low, high, unsigned) {
    var ret = unsigned ? (low >>> 0) + (high >>> 0) * 4294967296 : (low >>> 0) + (high | 0) * 4294967296;
    return ret;
  },
  QUANTUM_SIZE: 4,
  __dummy__: 0
};

var CorrectionsMonitor = {
  MAX_ALLOWED: 0,
  corrections: 0,
  sigs: {},
  note: (function(type, succeed, sig) {
    if (!succeed) {
      this.corrections++;
      if (this.corrections >= this.MAX_ALLOWED) abort("\n\nToo many corrections!");
    }
  }),
  print: (function() {})
};

var __THREW__ = false;

var ABORT = false;

var undef = 0;

var tempValue, tempInt, tempBigInt, tempInt2, tempBigInt2, tempPair, tempBigIntI, tempBigIntR, tempBigIntS, tempBigIntP, tempBigIntD;

var tempI64, tempI64b;

function abort(text) {
  Module.print(text + ":\n" + (new Error).stack);
  ABORT = true;
  throw "Assertion: " + text;
}

function assert(condition, text) {
  if (!condition) {
    abort("Assertion failed: " + text);
  }
}

var globalScope = this;

function ccall(ident, returnType, argTypes, args) {
  var stack = 0;
  function toC(value, type) {
    if (type == "string") {
      if (value === null || value === undefined || value === 0) return 0;
      if (!stack) stack = Runtime.stackSave();
      var ret = Runtime.stackAlloc(value.length + 1);
      writeStringToMemory(value, ret);
      return ret;
    } else if (type == "array") {
      if (!stack) stack = Runtime.stackSave();
      var ret = Runtime.stackAlloc(value.length);
      writeArrayToMemory(value, ret);
      return ret;
    }
    return value;
  }
  function fromC(value, type) {
    if (type == "string") {
      return Pointer_stringify(value);
    }
    assert(type != "array");
    return value;
  }
  try {
    var func = eval("_" + ident);
  } catch (e) {
    try {
      func = globalScope["Module"]["_" + ident];
    } catch (e) {}
  }
  assert(func, "Cannot call unknown function " + ident + " (perhaps LLVM optimizations or closure removed it?)");
  var i = 0;
  var cArgs = args ? args.map((function(arg) {
    return toC(arg, argTypes[i++]);
  })) : [];
  var ret = fromC(func.apply(null, cArgs), returnType);
  if (stack) Runtime.stackRestore(stack);
  return ret;
}

Module["ccall"] = ccall;

function cwrap(ident, returnType, argTypes) {
  return (function() {
    return ccall(ident, returnType, argTypes, Array.prototype.slice.call(arguments));
  });
}

Module["cwrap"] = cwrap;

function setValue(ptr, value, type, noSafe) {
  type = type || "i8";
  if (type[type.length - 1] === "*") type = "i32";
  switch (type) {
   case "i1":
    HEAP8[ptr] = value;
    break;
   case "i8":
    HEAP8[ptr] = value;
    break;
   case "i16":
    HEAP16[ptr >> 1] = value;
    break;
   case "i32":
    HEAP32[ptr >> 2] = value;
    break;
   case "i64":
    HEAP32[ptr >> 2] = value;
    break;
   case "float":
    HEAPF32[ptr >> 2] = value;
    break;
   case "double":
    tempDoubleF64[0] = value, HEAP32[ptr >> 2] = tempDoubleI32[0], HEAP32[ptr + 4 >> 2] = tempDoubleI32[1];
    break;
   default:
    abort("invalid type for setValue: " + type);
  }
}

Module["setValue"] = setValue;

function getValue(ptr, type, noSafe) {
  type = type || "i8";
  if (type[type.length - 1] === "*") type = "i32";
  switch (type) {
   case "i1":
    return HEAP8[ptr];
   case "i8":
    return HEAP8[ptr];
   case "i16":
    return HEAP16[ptr >> 1];
   case "i32":
    return HEAP32[ptr >> 2];
   case "i64":
    return HEAP32[ptr >> 2];
   case "float":
    return HEAPF32[ptr >> 2];
   case "double":
    return tempDoubleI32[0] = HEAP32[ptr >> 2], tempDoubleI32[1] = HEAP32[ptr + 4 >> 2], tempDoubleF64[0];
   default:
    abort("invalid type for setValue: " + type);
  }
  return null;
}

Module["getValue"] = getValue;

var ALLOC_NORMAL = 0;

var ALLOC_STACK = 1;

var ALLOC_STATIC = 2;

Module["ALLOC_NORMAL"] = ALLOC_NORMAL;

Module["ALLOC_STACK"] = ALLOC_STACK;

Module["ALLOC_STATIC"] = ALLOC_STATIC;

function allocate(slab, types, allocator) {
  var zeroinit, size;
  if (typeof slab === "number") {
    zeroinit = true;
    size = slab;
  } else {
    zeroinit = false;
    size = slab.length;
  }
  var singleType = typeof types === "string" ? types : null;
  var ret = [ _malloc, Runtime.stackAlloc, Runtime.staticAlloc ][allocator === undefined ? ALLOC_STATIC : allocator](Math.max(size, singleType ? 1 : types.length));
  if (zeroinit) {
    _memset(ret, 0, size);
    return ret;
  }
  var i = 0, type;
  while (i < size) {
    var curr = slab[i];
    if (typeof curr === "function") {
      curr = Runtime.getFunctionIndex(curr);
    }
    type = singleType || types[i];
    if (type === 0) {
      i++;
      continue;
    }
    assert(type, "Must know what type to store in allocate!");
    if (type == "i64") type = "i32";
    setValue(ret + i, curr, type);
    i += Runtime.getNativeTypeSize(type);
  }
  return ret;
}

Module["allocate"] = allocate;

function Pointer_stringify(ptr, length) {
  var nullTerminated = typeof length == "undefined";
  var ret = "";
  var i = 0;
  var t;
  var nullByte = String.fromCharCode(0);
  while (1) {
    t = String.fromCharCode(HEAPU8[ptr + i]);
    if (nullTerminated && t == nullByte) {
      break;
    } else {}
    ret += t;
    i += 1;
    if (!nullTerminated && i == length) {
      break;
    }
  }
  return ret;
}

Module["Pointer_stringify"] = Pointer_stringify;

function Array_stringify(array) {
  var ret = "";
  for (var i = 0; i < array.length; i++) {
    ret += String.fromCharCode(array[i]);
  }
  return ret;
}

Module["Array_stringify"] = Array_stringify;

var FUNCTION_TABLE;

var PAGE_SIZE = 4096;

function alignMemoryPage(x) {
  return x + 4095 >> 12 << 12;
}

var HEAP;

var HEAP8, HEAPU8, HEAP16, HEAPU16, HEAP32, HEAPU32, HEAPF32, HEAPF64;

var STACK_ROOT, STACKTOP, STACK_MAX;

var STATICTOP;

function enlargeMemory() {
  Module.printErr("Warning: Enlarging memory arrays, this is not fast! " + [ STATICTOP, TOTAL_MEMORY ]);
  assert(STATICTOP >= TOTAL_MEMORY);
  assert(TOTAL_MEMORY > 4);
  while (TOTAL_MEMORY <= STATICTOP) {
    TOTAL_MEMORY = alignMemoryPage(2 * TOTAL_MEMORY);
  }
  var oldHEAP8 = HEAP8;
  var buffer = new ArrayBuffer(TOTAL_MEMORY);
  HEAP8 = new Int8Array(buffer);
  HEAP16 = new Int16Array(buffer);
  HEAP32 = new Int32Array(buffer);
  HEAPU8 = new Uint8Array(buffer);
  HEAPU16 = new Uint16Array(buffer);
  HEAPU32 = new Uint32Array(buffer);
  HEAPF32 = new Float32Array(buffer);
  HEAPF64 = new Float64Array(buffer);
  HEAP8.set(oldHEAP8);
}

var TOTAL_STACK = Module["TOTAL_STACK"] || 5242880;

var TOTAL_MEMORY = Module["TOTAL_MEMORY"] || 10485760;

var FAST_MEMORY = Module["FAST_MEMORY"] || 2097152;

assert(!!Int32Array && !!Float64Array && !!(new Int32Array(1))["subarray"] && !!(new Int32Array(1))["set"], "Cannot fallback to non-typed array case: Code is too specialized");

var buffer = new ArrayBuffer(TOTAL_MEMORY);

HEAP8 = new Int8Array(buffer);

HEAP16 = new Int16Array(buffer);

HEAP32 = new Int32Array(buffer);

HEAPU8 = new Uint8Array(buffer);

HEAPU16 = new Uint16Array(buffer);

HEAPU32 = new Uint32Array(buffer);

HEAPF32 = new Float32Array(buffer);

HEAPF64 = new Float64Array(buffer);

HEAP32[0] = 255;

assert(HEAPU8[0] === 255 && HEAPU8[3] === 0, "Typed arrays 2 must be run on a little-endian system");

var base = intArrayFromString("(null)");

STATICTOP = base.length;

for (var i = 0; i < base.length; i++) {
  HEAP8[i] = base[i];
}

Module["HEAP"] = HEAP;

Module["HEAP8"] = HEAP8;

Module["HEAP16"] = HEAP16;

Module["HEAP32"] = HEAP32;

Module["HEAPU8"] = HEAPU8;

Module["HEAPU16"] = HEAPU16;

Module["HEAPU32"] = HEAPU32;

Module["HEAPF32"] = HEAPF32;

Module["HEAPF64"] = HEAPF64;

STACK_ROOT = STACKTOP = Runtime.alignMemory(STATICTOP);

STACK_MAX = STACK_ROOT + TOTAL_STACK;

var tempDoublePtr = Runtime.alignMemory(STACK_MAX, 8);

var tempDoubleI8 = HEAP8.subarray(tempDoublePtr);

var tempDoubleI32 = HEAP32.subarray(tempDoublePtr >> 2);

var tempDoubleF32 = HEAPF32.subarray(tempDoublePtr >> 2);

var tempDoubleF64 = HEAPF64.subarray(tempDoublePtr >> 3);

function copyTempFloat(ptr) {
  tempDoubleI8[0] = HEAP8[ptr];
  tempDoubleI8[1] = HEAP8[ptr + 1];
  tempDoubleI8[2] = HEAP8[ptr + 2];
  tempDoubleI8[3] = HEAP8[ptr + 3];
}

function copyTempDouble(ptr) {
  tempDoubleI8[0] = HEAP8[ptr];
  tempDoubleI8[1] = HEAP8[ptr + 1];
  tempDoubleI8[2] = HEAP8[ptr + 2];
  tempDoubleI8[3] = HEAP8[ptr + 3];
  tempDoubleI8[4] = HEAP8[ptr + 4];
  tempDoubleI8[5] = HEAP8[ptr + 5];
  tempDoubleI8[6] = HEAP8[ptr + 6];
  tempDoubleI8[7] = HEAP8[ptr + 7];
}

STACK_MAX = tempDoublePtr + 8;

STATICTOP = alignMemoryPage(STACK_MAX);

function callRuntimeCallbacks(callbacks) {
  while (callbacks.length > 0) {
    var callback = callbacks.shift();
    var func = callback.func;
    if (typeof func === "number") {
      func = FUNCTION_TABLE[func];
    }
    func(callback.arg === undefined ? null : callback.arg);
  }
}

var __ATINIT__ = [];

var __ATMAIN__ = [];

var __ATEXIT__ = [];

function initRuntime() {
  callRuntimeCallbacks(__ATINIT__);
}

function preMain() {
  callRuntimeCallbacks(__ATMAIN__);
}

function exitRuntime() {
  callRuntimeCallbacks(__ATEXIT__);
  CorrectionsMonitor.print();
}

function String_len(ptr) {
  var i = 0;
  while (HEAP8[ptr + i]) i++;
  return i;
}

Module["String_len"] = String_len;

function intArrayFromString(stringy, dontAddNull, length) {
  var ret = [];
  var t;
  var i = 0;
  if (length === undefined) {
    length = stringy.length;
  }
  while (i < length) {
    var chr = stringy.charCodeAt(i);
    if (chr > 255) {
      assert(false, "Character code " + chr + " (" + stringy[i] + ")  at offset " + i + " not in 0x00-0xFF.");
      chr &= 255;
    }
    ret.push(chr);
    i = i + 1;
  }
  if (!dontAddNull) {
    ret.push(0);
  }
  return ret;
}

Module["intArrayFromString"] = intArrayFromString;

function intArrayToString(array) {
  var ret = [];
  for (var i = 0; i < array.length; i++) {
    var chr = array[i];
    if (chr > 255) {
      assert(false, "Character code " + chr + " (" + String.fromCharCode(chr) + ")  at offset " + i + " not in 0x00-0xFF.");
      chr &= 255;
    }
    ret.push(String.fromCharCode(chr));
  }
  return ret.join("");
}

Module["intArrayToString"] = intArrayToString;

function writeStringToMemory(string, buffer, dontAddNull) {
  var i = 0;
  while (i < string.length) {
    var chr = string.charCodeAt(i);
    if (chr > 255) {
      assert(false, "Character code " + chr + " (" + string[i] + ")  at offset " + i + " not in 0x00-0xFF.");
      chr &= 255;
    }
    HEAP8[buffer + i] = chr;
    i = i + 1;
  }
  if (!dontAddNull) {
    HEAP8[buffer + i] = 0;
  }
}

Module["writeStringToMemory"] = writeStringToMemory;

function writeArrayToMemory(array, buffer) {
  for (var i = 0; i < array.length; i++) {
    HEAP8[buffer + i] = array[i];
  }
}

Module["writeArrayToMemory"] = writeArrayToMemory;

var STRING_TABLE = [];

function unSign(value, bits, ignore, sig) {
  if (value >= 0) {
    return value;
  }
  return bits <= 32 ? 2 * Math.abs(1 << bits - 1) + value : Math.pow(2, bits) + value;
}

function reSign(value, bits, ignore, sig) {
  if (value <= 0) {
    return value;
  }
  var half = bits <= 32 ? Math.abs(1 << bits - 1) : Math.pow(2, bits - 1);
  if (value >= half && (bits <= 32 || value > half)) {
    value = -2 * half + value;
  }
  return value;
}

var runDependencies = 0;

function addRunDependency() {
  runDependencies++;
  if (Module["monitorRunDependencies"]) {
    Module["monitorRunDependencies"](runDependencies);
  }
}

Module["addRunDependency"] = addRunDependency;

function removeRunDependency() {
  runDependencies--;
  if (Module["monitorRunDependencies"]) {
    Module["monitorRunDependencies"](runDependencies);
  }
  if (runDependencies == 0) run();
}

Module["removeRunDependency"] = removeRunDependency;

function _hash_block_tag($str, $len) {
  if (($len | 0) == 1) {
    var $hval_0 = 1;
  } else {
    var $6 = STRING_TABLE._hash_block_tag_asso_values + (HEAPU8[$str + 1 | 0] & 255) + 1 | 0;
    var $hval_0 = (HEAPU8[$6] & 255) + $len | 0;
  }
  var $hval_0;
  var $13 = STRING_TABLE._hash_block_tag_asso_values + (HEAPU8[$str] & 255) | 0;
  return (HEAPU8[$13] & 255) + $hval_0 | 0;
  return null;
}

function _str_to_html($in) {
  var __stackBase__ = STACKTOP;
  STACKTOP += 124;
  assert(STACKTOP % 4 == 0, "Stack is unaligned");
  assert(STACKTOP < STACK_MAX, "Ran out of stack");
  var $callbacks = __stackBase__;
  var $options = __stackBase__ + 104;
  var $1 = _bufnew(2048);
  _sdhtml_renderer($callbacks, $options, 0);
  var $2 = $options;
  var $3 = _sd_markdown_new(479, 16, $callbacks, $2);
  var $4 = _strlen($in);
  _sd_markdown_render($1, $in, $4, $3);
  _sd_markdown_free($3);
  var $7 = HEAP32[$1 + 4 >> 2] + 1 | 0;
  var $8 = _malloc($7);
  var $9 = _bufcstr($1);
  var $10 = _strcpy($8, $9);
  _bufrelease($1);
  STACKTOP = __stackBase__;
  return $8;
  return null;
}

Module["_str_to_html"] = _str_to_html;

function _find_block_tag($str, $len) {
  var __label__;
  var $or_cond = $len >>> 0 < 11 & ($len | 0) != 0;
  do {
    if ($or_cond) {
      var $4 = _hash_block_tag($str, $len);
      if ($4 >>> 0 >= 38) {
        __label__ = 7;
        break;
      }
      var $8 = HEAPU32[_find_block_tag_wordlist + ($4 << 2) >> 2];
      if (((HEAP8[$8] ^ HEAP8[$str]) & -33) << 24 >> 24 != 0) {
        __label__ = 7;
        break;
      }
      var $15 = _strncasecmp($str, $8, $len);
      if (($15 | 0) != 0) {
        __label__ = 7;
        break;
      }
      if (HEAP8[$8 + $len | 0] << 24 >> 24 == 0) {
        var $_0 = $8;
        __label__ = 8;
        break;
      }
      __label__ = 7;
      break;
    } else {
      __label__ = 7;
    }
  } while (0);
  if (__label__ == 7) {
    var $_0 = 0;
  }
  var $_0;
  return $_0;
  return null;
}

function _sd_markdown_new($extensions, $max_nesting, $callbacks, $opaque) {
  var $5$s2;
  var __label__;
  if (($max_nesting | 0) == 0 | ($callbacks | 0) == 0) {
    ___assert_func(STRING_TABLE.__str25 | 0, 2400, STRING_TABLE.___func___sd_markdown_new | 0, STRING_TABLE.__str26 | 0);
  }
  var $5 = _malloc(432), $5$s2 = $5 >> 2;
  var $6 = $5;
  if (($5 | 0) == 0) {
    var $_0 = 0;
  } else {
    var $9 = $callbacks;
    assert(104 % 1 === 0, "memcpy given " + 104 + " bytes to copy. Problem with quantum=1 corrections perhaps?");
    for (var $$src = $9 >> 2, $$dest = $5$s2, $$stop = $$src + 26; $$src < $$stop; $$src++, $$dest++) {
      HEAP32[$$dest] = HEAP32[$$src];
    }
    var $11 = $5 + 396 | 0;
    var $12 = _stack_init($11, 4);
    var $14 = $5 + 408 | 0;
    var $15 = _stack_init($14, 8);
    var $16 = $5 + 140 | 0;
    _memset($16, 0, 256, 1);
    var $20 = (HEAP32[$5$s2 + 14] | 0) == 0;
    do {
      if ($20) {
        if ((HEAP32[$5$s2 + 13] | 0) != 0) {
          __label__ = 8;
          break;
        }
        if ((HEAP32[$5$s2 + 19] | 0) == 0) {
          __label__ = 10;
          break;
        }
        __label__ = 8;
        break;
      } else {
        __label__ = 8;
      }
    } while (0);
    do {
      if (__label__ == 8) {
        HEAP8[$5 + 182 | 0] = 1;
        HEAP8[$5 + 235 | 0] = 1;
        if (($extensions & 16 | 0) == 0) {
          break;
        }
        HEAP8[$5 + 266 | 0] = 1;
      }
    } while (0);
    if ((HEAP32[$5$s2 + 12] | 0) != 0) {
      HEAP8[$5 + 236 | 0] = 2;
    }
    if ((HEAP32[$5$s2 + 16] | 0) != 0) {
      HEAP8[$5 + 150 | 0] = 3;
    }
    var $56 = (HEAP32[$5$s2 + 15] | 0) == 0;
    do {
      if ($56) {
        if ((HEAP32[$5$s2 + 17] | 0) == 0) {
          __label__ = 17;
          break;
        }
        __label__ = 16;
        break;
      } else {
        __label__ = 16;
      }
    } while (0);
    if (__label__ == 16) {
      HEAP8[$5 + 231 | 0] = 4;
    }
    HEAP8[$5 + 200 | 0] = 5;
    HEAP8[$5 + 232 | 0] = 6;
    HEAP8[$5 + 178 | 0] = 7;
    if (($extensions & 8 | 0) != 0) {
      HEAP8[$5 + 198 | 0] = 8;
      HEAP8[$5 + 204 | 0] = 9;
      HEAP8[$5 + 259 | 0] = 10;
    }
    if (($extensions & 128 | 0) != 0) {
      HEAP8[$5 + 234 | 0] = 11;
    }
    HEAP32[$5$s2 + 105] = $extensions;
    HEAP32[$5$s2 + 26] = $opaque;
    HEAP32[$5$s2 + 106] = $max_nesting;
    HEAP32[$5$s2 + 107] = 0;
    var $_0 = $6;
  }
  var $_0;
  return $_0;
  return null;
}

_sd_markdown_new["X"] = 1;

function _sd_markdown_render($ob, $document, $doc_size, $md) {
  var $45$s2;
  var $6$s2;
  var $end$s2;
  var $md$s2 = $md >> 2;
  var __stackBase__ = STACKTOP;
  STACKTOP += 4;
  assert(STACKTOP % 4 == 0, "Stack is unaligned");
  assert(STACKTOP < STACK_MAX, "Ran out of stack");
  var __label__;
  var $end = __stackBase__, $end$s2 = $end >> 2;
  var $1 = _bufnew(64);
  var $2 = ($1 | 0) == 0;
  do {
    if (!$2) {
      var $4 = _bufgrow($1, $doc_size);
      var $5 = $md + 108 | 0;
      var $6$s2 = $5 >> 2;
      HEAP32[$6$s2] = 0;
      HEAP32[$6$s2 + 1] = 0;
      HEAP32[$6$s2 + 2] = 0;
      HEAP32[$6$s2 + 3] = 0;
      HEAP32[$6$s2 + 4] = 0;
      HEAP32[$6$s2 + 5] = 0;
      HEAP32[$6$s2 + 6] = 0;
      HEAP32[$6$s2 + 7] = 0;
      if ($doc_size >>> 0 > 2) {
        var $9 = _memcmp($document, STRING_TABLE._sd_markdown_render_UTF8_BOM | 0, 3);
        var $_ = ($9 | 0) == 0 ? 3 : 0;
        var $beg_0_ph = $_;
      } else {
        var $beg_0_ph = 0;
      }
      var $beg_0_ph;
      var $11 = $beg_0_ph >>> 0 < $doc_size >>> 0;
      $_$52 : do {
        if ($11) {
          var $12 = $5 | 0;
          var $beg_09 = $beg_0_ph;
          while (1) {
            var $beg_09;
            var $14 = _is_ref($document, $beg_09, $doc_size, $end, $12);
            var $15 = ($14 | 0) == 0;
            $_$56 : do {
              if ($15) {
                var $storemerge = $beg_09;
                while (1) {
                  var $storemerge;
                  if ($storemerge >>> 0 >= $doc_size >>> 0) {
                    break;
                  }
                  var $22 = HEAP8[$document + $storemerge | 0];
                  if ($22 << 24 >> 24 == 13 || $22 << 24 >> 24 == 10) {
                    break;
                  }
                  var $storemerge = $storemerge + 1 | 0;
                }
                HEAP32[$end$s2] = $storemerge;
                if ($storemerge >>> 0 > $beg_09 >>> 0) {
                  var $27 = $document + $beg_09 | 0;
                  _expand_tabs($1, $27, $storemerge - $beg_09 | 0);
                  var $29 = HEAP32[$end$s2];
                } else {
                  var $29 = $storemerge;
                  __label__ = 15;
                }
                while (1) {
                  var $29;
                  if ($29 >>> 0 >= $doc_size >>> 0) {
                    var $beg_0_be = $29;
                    break $_$56;
                  }
                  var $33 = HEAP8[$document + $29 | 0];
                  do {
                    if ($33 << 24 >> 24 == 10) {
                      __label__ = 19;
                    } else if ($33 << 24 >> 24 == 13) {
                      var $35 = $29 + 1 | 0;
                      if ($35 >>> 0 >= $doc_size >>> 0) {
                        var $43 = $29;
                        __label__ = 20;
                        break;
                      }
                      if (HEAP8[$document + $35 | 0] << 24 >> 24 == 10) {
                        var $43 = $29;
                        __label__ = 20;
                        break;
                      }
                      __label__ = 19;
                      break;
                    } else {
                      var $beg_0_be = $29;
                      break $_$56;
                    }
                  } while (0);
                  if (__label__ == 19) {
                    _bufputc($1, 10);
                    var $43 = HEAP32[$end$s2];
                  }
                  var $43;
                  var $44 = $43 + 1 | 0;
                  HEAP32[$end$s2] = $44;
                  var $29 = $44;
                }
              } else {
                var $beg_0_be = HEAP32[$end$s2];
              }
            } while (0);
            var $beg_0_be;
            if ($beg_0_be >>> 0 >= $doc_size >>> 0) {
              break $_$52;
            }
            var $beg_09 = $beg_0_be;
          }
        }
      } while (0);
      var $45$s2 = ($1 + 4 | 0) >> 2;
      var $46 = HEAPU32[$45$s2];
      var $48 = ($46 >>> 1) + $46 | 0;
      var $49 = _bufgrow($ob, $48);
      var $51 = HEAPU32[$md$s2 + 24];
      if (($51 | 0) != 0) {
        var $55 = HEAP32[$md$s2 + 26];
        FUNCTION_TABLE[$51]($ob, $55);
      }
      var $57 = HEAPU32[$45$s2];
      if (($57 | 0) != 0) {
        var $61 = $1 | 0;
        var $62 = HEAP32[$61 >> 2];
        var $64 = HEAP8[$62 + ($57 - 1) | 0];
        if ($64 << 24 >> 24 == 10 || $64 << 24 >> 24 == 13) {
          var $68 = $62;
          var $67 = $57;
        } else {
          _bufputc($1, 10);
          var $68 = HEAP32[$61 >> 2];
          var $67 = HEAP32[$45$s2];
        }
        var $67;
        var $68;
        _parse_block($ob, $md, $68, $67);
      }
      var $71 = HEAP32[$md$s2 + 25];
      if (($71 | 0) != 0) {
        var $75 = HEAP32[$md$s2 + 26];
        FUNCTION_TABLE[$71]($ob, $75);
      }
      _bufrelease($1);
      var $77 = $5 | 0;
      _free_link_refs($77);
      if ((HEAP32[$md$s2 + 103] | 0) != 0) {
        ___assert_func(STRING_TABLE.__str25 | 0, 2522, STRING_TABLE.___func___sd_markdown_render | 0, STRING_TABLE.__str27 | 0);
      }
      if ((HEAP32[$md$s2 + 100] | 0) == 0) {
        break;
      }
      ___assert_func(STRING_TABLE.__str25 | 0, 2523, STRING_TABLE.___func___sd_markdown_render | 0, STRING_TABLE.__str28 | 0);
    }
  } while (0);
  STACKTOP = __stackBase__;
  return;
  return;
}

_sd_markdown_render["X"] = 1;

function _is_ref($data, $beg, $end, $last, $refs) {
  var __label__;
  var $1 = $beg + 3 | 0;
  var $2 = $1 >>> 0 < $end >>> 0;
  $_$94 : do {
    if ($2) {
      var $6 = HEAP8[$data + $beg | 0] << 24 >> 24 == 32;
      do {
        if ($6) {
          if (HEAP8[$beg + ($data + 1) | 0] << 24 >> 24 != 32) {
            var $i_0 = 1;
            break;
          }
          if (HEAP8[$beg + ($data + 2) | 0] << 24 >> 24 != 32) {
            var $i_0 = 2;
            break;
          }
          if (HEAP8[$data + $1 | 0] << 24 >> 24 == 32) {
            var $_0 = 0;
            break $_$94;
          }
          var $i_0 = 3;
        } else {
          var $i_0 = 0;
        }
      } while (0);
      var $i_0;
      var $22 = $i_0 + $beg | 0;
      if (HEAP8[$data + $22 | 0] << 24 >> 24 != 91) {
        var $_0 = 0;
        break;
      }
      var $27 = $22 + 1 | 0;
      var $i_1 = $27;
      while (1) {
        var $i_1;
        if ($i_1 >>> 0 >= $end >>> 0) {
          var $_0 = 0;
          break $_$94;
        }
        var $32 = HEAP8[$data + $i_1 | 0];
        if ($32 << 24 >> 24 == 93) {
          break;
        } else if ($32 << 24 >> 24 == 10 || $32 << 24 >> 24 == 13) {
          var $_0 = 0;
          break $_$94;
        }
        var $i_1 = $i_1 + 1 | 0;
      }
      var $35 = $i_1 + 1 | 0;
      if ($35 >>> 0 >= $end >>> 0) {
        var $_0 = 0;
        break;
      }
      if (HEAP8[$data + $35 | 0] << 24 >> 24 != 58) {
        var $_0 = 0;
        break;
      }
      var $i_2 = $i_1 + 2 | 0;
      while (1) {
        var $i_2;
        if ($i_2 >>> 0 >= $end >>> 0) {
          var $i_3 = $i_2;
          __label__ = 21;
          break;
        }
        var $47 = HEAPU8[$data + $i_2 | 0];
        if ($47 << 24 >> 24 != 32) if ($47 << 24 >> 24 == 10 || $47 << 24 >> 24 == 13) {
          __label__ = 18;
          break;
        } else {
          var $i_3 = $i_2;
          __label__ = 21;
          break;
        }
        var $i_2 = $i_2 + 1 | 0;
      }
      do {
        if (__label__ == 18) {
          var $51 = $i_2 + 1 | 0;
          if ($51 >>> 0 >= $end >>> 0) {
            var $i_3 = $51;
            break;
          }
          if (HEAP8[$data + $51 | 0] << 24 >> 24 != 13) {
            var $i_3 = $51;
            break;
          }
          var $_ = $47 << 24 >> 24 == 10 ? $i_2 + 2 | 0 : $51;
          var $i_3 = $_;
        }
      } while (0);
      while (1) {
        var $i_3;
        if ($i_3 >>> 0 >= $end >>> 0) {
          var $_0 = 0;
          break $_$94;
        }
        var $63 = HEAPU8[$data + $i_3 | 0];
        if ($63 << 24 >> 24 != 32) {
          break;
        }
        var $i_3 = $i_3 + 1 | 0;
      }
      var $_i_3 = ($63 << 24 >> 24 == 60 & 1) + $i_3 | 0;
      var $i_5 = $_i_3;
      while (1) {
        var $i_5;
        if ($i_5 >>> 0 >= $end >>> 0) {
          break;
        }
        var $73 = HEAP8[$data + $i_5 | 0];
        if ($73 << 24 >> 24 == 32 || $73 << 24 >> 24 == 10 || $73 << 24 >> 24 == 13) {
          break;
        }
        var $i_5 = $i_5 + 1 | 0;
      }
      var $75 = $i_5 - 1 | 0;
      var $_i_5 = HEAP8[$data + $75 | 0] << 24 >> 24 == 62 ? $75 : $i_5;
      var $i_6 = $i_5;
      while (1) {
        var $i_6;
        if ($i_6 >>> 0 >= $end >>> 0) {
          var $line_end_0 = $i_6;
          break;
        }
        var $83 = HEAP8[$data + $i_6 | 0];
        if ($83 << 24 >> 24 == 32) {
          var $i_6 = $i_6 + 1 | 0;
        } else if ($83 << 24 >> 24 == 13 || $83 << 24 >> 24 == 10) {
          var $line_end_0 = $i_6;
          break;
        } else if ($83 << 24 >> 24 == 34 || $83 << 24 >> 24 == 39 || $83 << 24 >> 24 == 40) {
          var $line_end_0 = 0;
          break;
        } else {
          var $_0 = 0;
          break $_$94;
        }
      }
      var $line_end_0;
      var $86 = $i_6 + 1 | 0;
      var $87 = $86 >>> 0 < $end >>> 0;
      do {
        if ($87) {
          if (HEAP8[$data + $i_6 | 0] << 24 >> 24 != 10) {
            var $line_end_1 = $line_end_0;
            break;
          }
          var $_line_end_0 = HEAP8[$data + $86 | 0] << 24 >> 24 == 13 ? $86 : $line_end_0;
          var $line_end_1 = $_line_end_0;
        } else {
          var $line_end_1 = $line_end_0;
        }
      } while (0);
      var $line_end_1;
      var $97 = ($line_end_1 | 0) == 0;
      $_$137 : do {
        if ($97) {
          var $i_8 = $i_6;
        } else {
          var $i_7_in = $line_end_1;
          while (1) {
            var $i_7_in;
            var $i_7 = $i_7_in + 1 | 0;
            if ($i_7 >>> 0 >= $end >>> 0) {
              var $i_8 = $i_7;
              break $_$137;
            }
            if (HEAP8[$data + $i_7 | 0] << 24 >> 24 != 32) {
              var $i_8 = $i_7;
              break $_$137;
            }
            var $i_7_in = $i_7;
          }
        }
      } while (0);
      var $i_8;
      var $103 = $i_8 + 1 | 0;
      var $104 = $103 >>> 0 < $end >>> 0;
      $_$142 : do {
        if ($104) {
          var $107 = HEAP8[$data + $i_8 | 0];
          if (!($107 << 24 >> 24 == 39 || $107 << 24 >> 24 == 34 || $107 << 24 >> 24 == 40)) {
            var $line_end_2 = $line_end_1;
            var $title_end_1 = 0;
            var $title_offset_0 = 0;
            break;
          }
          var $i_9 = $103;
          while (1) {
            var $i_9;
            if ($i_9 >>> 0 >= $end >>> 0) {
              var $114 = $i_9 + 1 | 0;
              break;
            }
            var $112 = HEAP8[$data + $i_9 | 0];
            var $113 = $i_9 + 1 | 0;
            if ($112 << 24 >> 24 == 13 || $112 << 24 >> 24 == 10) {
              var $114 = $113;
              break;
            }
            var $i_9 = $113;
          }
          var $114;
          var $115 = $114 >>> 0 < $end >>> 0;
          do {
            if ($115) {
              if (HEAP8[$data + $i_9 | 0] << 24 >> 24 != 10) {
                __label__ = 46;
                break;
              }
              if (HEAP8[$data + $114 | 0] << 24 >> 24 == 13) {
                var $title_end_0 = $114;
                __label__ = 47;
                break;
              }
              __label__ = 46;
              break;
            } else {
              __label__ = 46;
            }
          } while (0);
          if (__label__ == 46) {
            var $title_end_0 = $i_9;
          }
          var $title_end_0;
          var $i_10_in = $i_9;
          while (1) {
            var $i_10_in;
            var $i_10 = $i_10_in - 1 | 0;
            if ($i_10 >>> 0 <= $103 >>> 0) {
              var $line_end_2 = $line_end_1;
              var $title_end_1 = $title_end_0;
              var $title_offset_0 = $103;
              break $_$142;
            }
            var $130 = HEAP8[$data + $i_10 | 0];
            if ($130 << 24 >> 24 == 32) {
              var $i_10_in = $i_10;
            } else if ($130 << 24 >> 24 == 39 || $130 << 24 >> 24 == 34 || $130 << 24 >> 24 == 41) {
              break;
            } else {
              var $line_end_2 = $line_end_1;
              var $title_end_1 = $title_end_0;
              var $title_offset_0 = $103;
              break $_$142;
            }
          }
          var $line_end_2 = $title_end_0;
          var $title_end_1 = $i_10;
          var $title_offset_0 = $103;
        } else {
          var $line_end_2 = $line_end_1;
          var $title_end_1 = 0;
          var $title_offset_0 = 0;
        }
      } while (0);
      var $title_offset_0;
      var $title_end_1;
      var $line_end_2;
      if (($line_end_2 | 0) == 0 | ($_i_5 | 0) == ($_i_3 | 0)) {
        var $_0 = 0;
        break;
      }
      if (($last | 0) != 0) {
        HEAP32[$last >> 2] = $line_end_2;
      }
      if (($refs | 0) == 0) {
        var $_0 = 1;
        break;
      }
      var $139 = $data + $27 | 0;
      var $140 = $i_1 - $27 | 0;
      var $141 = _add_link_ref($refs, $139, $140);
      if (($141 | 0) == 0) {
        var $_0 = 0;
        break;
      }
      var $144 = $_i_5 - $_i_3 | 0;
      var $145 = _bufnew($144);
      HEAP32[$141 + 4 >> 2] = $145;
      var $147 = $data + $_i_3 | 0;
      _bufput($145, $147, $144);
      if ($title_end_1 >>> 0 <= $title_offset_0 >>> 0) {
        var $_0 = 1;
        break;
      }
      var $150 = $title_end_1 - $title_offset_0 | 0;
      var $151 = _bufnew($150);
      HEAP32[$141 + 8 >> 2] = $151;
      var $153 = $data + $title_offset_0 | 0;
      _bufput($151, $153, $150);
      var $_0 = 1;
    } else {
      var $_0 = 0;
    }
  } while (0);
  var $_0;
  return $_0;
  return null;
}

_is_ref["X"] = 1;

function _expand_tabs($ob, $line, $size) {
  var __label__;
  var $tab_0 = 0;
  var $i_0 = 0;
  while (1) {
    var $i_0;
    var $tab_0;
    if ($i_0 >>> 0 >= $size >>> 0) {
      break;
    }
    var $tab_1 = $tab_0;
    var $i_1 = $i_0;
    while (1) {
      var $i_1;
      var $tab_1;
      if ($i_1 >>> 0 >= $size >>> 0) {
        var $_lcssa = 0;
        break;
      }
      if (HEAP8[$line + $i_1 | 0] << 24 >> 24 == 9) {
        var $_lcssa = 1;
        break;
      }
      var $tab_1 = $tab_1 + 1 | 0;
      var $i_1 = $i_1 + 1 | 0;
    }
    var $_lcssa;
    if ($i_1 >>> 0 > $i_0 >>> 0) {
      var $13 = $line + $i_0 | 0;
      _bufput($ob, $13, $i_1 - $i_0 | 0);
    } else {
      __label__ = 9;
    }
    if (!$_lcssa) {
      break;
    }
    var $tab_2 = $tab_1;
    while (1) {
      var $tab_2;
      _bufputc($ob, 32);
      var $16 = $tab_2 + 1 | 0;
      if (($16 & 3 | 0) == 0) {
        break;
      }
      var $tab_2 = $16;
    }
    var $tab_0 = $16;
    var $i_0 = $i_1 + 1 | 0;
  }
  return;
  return;
}

function _sd_version($ver_major, $ver_minor, $ver_revision) {
  HEAP32[$ver_major >> 2] = 1;
  HEAP32[$ver_minor >> 2] = 16;
  HEAP32[$ver_revision >> 2] = 0;
  return;
  return;
}

function _is_atxheader($rndr, $data, $size) {
  var $2 = HEAP8[$data] << 24 >> 24 == 35;
  $_$71 : do {
    if ($2) {
      var $7 = (HEAP32[$rndr + 420 >> 2] & 64 | 0) == 0;
      $_$73 : do {
        if (!$7) {
          var $level_0 = 0;
          while (1) {
            var $level_0;
            var $8 = $level_0 >>> 0 < $size >>> 0;
            if (!($8 & $level_0 >>> 0 < 6)) {
              if (!$8) {
                break $_$73;
              }
              var $15 = HEAP8[$data + $level_0 | 0];
              break;
            }
            var $12 = HEAPU8[$data + $level_0 | 0];
            if ($12 << 24 >> 24 != 35) {
              var $15 = $12;
              break;
            }
            var $level_0 = $level_0 + 1 | 0;
          }
          var $15;
          if ($15 << 24 >> 24 != 32) {
            var $_0 = 0;
            break $_$71;
          }
        }
      } while (0);
      var $_0 = 1;
    } else {
      var $_0 = 0;
    }
  } while (0);
  var $_0;
  return $_0;
  return null;
}

function _is_empty($data, $size) {
  var $i_0 = 0;
  $_$157 : while (1) {
    var $i_0;
    var $2 = $i_0 >>> 0 < $size >>> 0;
    do {
      if ($2) {
        var $5 = HEAP8[$data + $i_0 | 0];
        if ($5 << 24 >> 24 == 10) {
          break;
        } else if ($5 << 24 >> 24 != 32) {
          var $_0 = 0;
          break $_$157;
        }
        var $i_0 = $i_0 + 1 | 0;
        continue $_$157;
      }
    } while (0);
    var $_0 = $i_0 + 1 | 0;
    break;
  }
  var $_0;
  return $_0;
  return null;
}

function _is_hrule($data, $size) {
  var $1 = $size >>> 0 < 3;
  $_$165 : do {
    if ($1) {
      var $_0 = 0;
    } else {
      var $4 = HEAP8[$data] << 24 >> 24 == 32;
      do {
        if ($4) {
          if (HEAP8[$data + 1 | 0] << 24 >> 24 != 32) {
            var $i_0 = 1;
            break;
          }
          var $_ = HEAP8[$data + 2 | 0] << 24 >> 24 == 32 ? 3 : 2;
          var $i_0 = $_;
        } else {
          var $i_0 = 0;
        }
      } while (0);
      var $i_0;
      if (($i_0 + 2 | 0) >>> 0 >= $size >>> 0) {
        var $_0 = 0;
        break;
      }
      var $18 = HEAPU8[$data + $i_0 | 0];
      if (!($18 << 24 >> 24 == 42 || $18 << 24 >> 24 == 45 || $18 << 24 >> 24 == 95)) {
        var $_0 = 0;
        break;
      }
      var $n_0 = 0;
      var $i_1 = $i_0;
      while (1) {
        var $i_1;
        var $n_0;
        if ($i_1 >>> 0 >= $size >>> 0) {
          break;
        }
        var $22 = HEAPU8[$data + $i_1 | 0];
        if ($22 << 24 >> 24 == 10) {
          break;
        }
        if ($22 << 24 >> 24 == $18 << 24 >> 24) {
          var $n_1 = $n_0 + 1 | 0;
        } else {
          if ($22 << 24 >> 24 != 32) {
            var $_0 = 0;
            break $_$165;
          }
          var $n_1 = $n_0;
        }
        var $n_1;
        var $n_0 = $n_1;
        var $i_1 = $i_1 + 1 | 0;
      }
      var $_0 = $n_0 >>> 0 > 2 & 1;
    }
  } while (0);
  var $_0;
  return $_0;
  return null;
}

function _parse_block($ob, $rndr, $data, $size) {
  var __label__;
  var $or_cond = (HEAP32[$rndr + 400 >> 2] + HEAP32[$rndr + 412 >> 2] | 0) >>> 0 > HEAPU32[$rndr + 424 >> 2] >>> 0 | ($size | 0) == 0;
  $_$2 : do {
    if (!$or_cond) {
      var $10 = $rndr + 8 | 0;
      var $11 = $rndr + 420 | 0;
      var $12 = $rndr + 16 | 0;
      var $13 = $rndr + 104 | 0;
      var $beg_04 = 0;
      while (1) {
        var $beg_04;
        var $15 = $data + $beg_04 | 0;
        var $16 = $size - $beg_04 | 0;
        var $17 = _is_atxheader($rndr, $15, $16);
        var $18 = ($17 | 0) == 0;
        $_$6 : do {
          if ($18) {
            var $24 = HEAP8[$15] << 24 >> 24 == 60;
            do {
              if ($24) {
                if ((HEAP32[$10 >> 2] | 0) == 0) {
                  break;
                }
                var $29 = _parse_htmlblock($ob, $rndr, $15, $16, 1);
                if (($29 | 0) == 0) {
                  break;
                }
                var $beg_0_be = $29 + $beg_04 | 0;
                break $_$6;
              }
            } while (0);
            var $35 = _is_empty($15, $16);
            if (($35 | 0) == 0) {
              var $40 = _is_hrule($15, $16);
              if (($40 | 0) == 0) {
                var $55 = HEAPU32[$11 >> 2];
                if (($55 & 4 | 0) == 0) {
                  var $64 = $55;
                } else {
                  var $59 = _parse_fencedcode($ob, $rndr, $15, $16);
                  if (($59 | 0) != 0) {
                    var $beg_0_be = $59 + $beg_04 | 0;
                    break;
                  }
                  var $64 = HEAP32[$11 >> 2];
                }
                var $64;
                var $66 = ($64 & 2 | 0) == 0;
                do {
                  if (!$66) {
                    var $68 = _parse_table($ob, $rndr, $15, $16);
                    if (($68 | 0) == 0) {
                      break;
                    }
                    var $beg_0_be = $68 + $beg_04 | 0;
                    break $_$6;
                  }
                } while (0);
                var $73 = _prefix_quote($15, $16);
                if (($73 | 0) == 0) {
                  var $79 = _prefix_code($15, $16);
                  if (($79 | 0) == 0) {
                    var $85 = _prefix_uli($15, $16);
                    if (($85 | 0) == 0) {
                      var $91 = _prefix_oli($15, $16);
                      if (($91 | 0) == 0) {
                        var $97 = _parse_paragraph($ob, $rndr, $15, $16);
                        var $beg_0_be = $97 + $beg_04 | 0;
                      } else {
                        var $94 = _parse_list($ob, $rndr, $15, $16, 1);
                        var $beg_0_be = $94 + $beg_04 | 0;
                      }
                    } else {
                      var $88 = _parse_list($ob, $rndr, $15, $16, 0);
                      var $beg_0_be = $88 + $beg_04 | 0;
                    }
                  } else {
                    var $82 = _parse_blockcode($ob, $rndr, $15, $16);
                    var $beg_0_be = $82 + $beg_04 | 0;
                  }
                } else {
                  var $76 = _parse_blockquote($ob, $rndr, $15, $16);
                  var $beg_0_be = $76 + $beg_04 | 0;
                }
              } else {
                var $43 = HEAP32[$12 >> 2];
                if (($43 | 0) == 0) {
                  var $beg_1 = $beg_04;
                  __label__ = 16;
                } else {
                  var $46 = HEAP32[$13 >> 2];
                  FUNCTION_TABLE[$43]($ob, $46);
                  var $beg_1 = $beg_04;
                }
                while (1) {
                  var $beg_1;
                  if ($beg_1 >>> 0 >= $size >>> 0) {
                    break;
                  }
                  var $52 = $beg_1 + 1 | 0;
                  if (HEAP8[$data + $beg_1 | 0] << 24 >> 24 == 10) {
                    var $beg_0_be = $52;
                    break $_$6;
                  }
                  var $beg_1 = $52;
                }
                var $beg_0_be = $beg_1 + 1 | 0;
              }
            } else {
              var $beg_0_be = $35 + $beg_04 | 0;
            }
          } else {
            var $20 = _parse_atxheader($ob, $rndr, $15, $16);
            var $beg_0_be = $20 + $beg_04 | 0;
          }
        } while (0);
        var $beg_0_be;
        if ($beg_0_be >>> 0 >= $size >>> 0) {
          break $_$2;
        }
        var $beg_04 = $beg_0_be;
      }
    }
  } while (0);
  return;
  return;
}

_parse_block["X"] = 1;

function _free_link_refs($references) {
  var $r_01$s2;
  var $i_02 = 0;
  while (1) {
    var $i_02;
    var $3 = HEAP32[$references + ($i_02 << 2) >> 2];
    var $4 = ($3 | 0) == 0;
    $_$53 : do {
      if (!$4) {
        var $r_01 = $3, $r_01$s2 = $r_01 >> 2;
        while (1) {
          var $r_01;
          var $6 = HEAP32[$r_01$s2 + 3];
          var $8 = HEAP32[$r_01$s2 + 1];
          _bufrelease($8);
          var $10 = HEAP32[$r_01$s2 + 2];
          _bufrelease($10);
          _free($r_01);
          if (($6 | 0) == 0) {
            break $_$53;
          }
          var $r_01 = $6, $r_01$s2 = $r_01 >> 2;
        }
      }
    } while (0);
    var $13 = $i_02 + 1 | 0;
    if (($13 | 0) == 8) {
      break;
    }
    var $i_02 = $13;
  }
  return;
  return;
}

function _sd_markdown_free($md) {
  var $1 = $md + 408 | 0;
  var $2 = $md + 416 | 0;
  var $4 = (HEAP32[$2 >> 2] | 0) == 0;
  $_$59 : do {
    if (!$4) {
      var $5 = $1 | 0;
      var $i_03 = 0;
      while (1) {
        var $i_03;
        var $15 = HEAP32[HEAP32[$5 >> 2] + ($i_03 << 2) >> 2];
        _bufrelease($15);
        var $16 = $i_03 + 1 | 0;
        if ($16 >>> 0 >= HEAPU32[$2 >> 2] >>> 0) {
          break $_$59;
        }
        var $i_03 = $16;
      }
    }
  } while (0);
  var $6 = $md + 396 | 0;
  var $7 = $md + 404 | 0;
  var $9 = (HEAP32[$7 >> 2] | 0) == 0;
  $_$64 : do {
    if (!$9) {
      var $10 = $6 | 0;
      var $i_11 = 0;
      while (1) {
        var $i_11;
        var $23 = HEAP32[HEAP32[$10 >> 2] + ($i_11 << 2) >> 2];
        _bufrelease($23);
        var $24 = $i_11 + 1 | 0;
        if ($24 >>> 0 >= HEAPU32[$7 >> 2] >>> 0) {
          break $_$64;
        }
        var $i_11 = $24;
      }
    }
  } while (0);
  _stack_free($1);
  _stack_free($6);
  var $27 = $md;
  _free($27);
  return;
  return;
}

function _parse_atxheader($ob, $rndr, $data, $size) {
  var $level_0 = 0;
  while (1) {
    var $level_0;
    if (!($level_0 >>> 0 < $size >>> 0 & $level_0 >>> 0 < 6)) {
      var $i_0 = $level_0;
      break;
    }
    if (HEAP8[$data + $level_0 | 0] << 24 >> 24 != 35) {
      var $i_0 = $level_0;
      break;
    }
    var $level_0 = $level_0 + 1 | 0;
  }
  while (1) {
    var $i_0;
    if ($i_0 >>> 0 >= $size >>> 0) {
      var $end_0 = $i_0;
      break;
    }
    if (HEAP8[$data + $i_0 | 0] << 24 >> 24 != 32) {
      var $end_0 = $i_0;
      break;
    }
    var $i_0 = $i_0 + 1 | 0;
  }
  while (1) {
    var $end_0;
    if ($end_0 >>> 0 >= $size >>> 0) {
      var $end_1 = $end_0;
      break;
    }
    if (HEAP8[$data + $end_0 | 0] << 24 >> 24 == 10) {
      var $end_1 = $end_0;
      break;
    }
    var $end_0 = $end_0 + 1 | 0;
  }
  while (1) {
    var $end_1;
    if (($end_1 | 0) == 0) {
      var $end_2 = 0;
      break;
    }
    var $23 = $end_1 - 1 | 0;
    if (HEAP8[$data + $23 | 0] << 24 >> 24 != 35) {
      var $end_2 = $end_1;
      break;
    }
    var $end_1 = $23;
  }
  while (1) {
    var $end_2;
    if (($end_2 | 0) == 0) {
      break;
    }
    var $29 = $end_2 - 1 | 0;
    if (HEAP8[$data + $29 | 0] << 24 >> 24 != 32) {
      break;
    }
    var $end_2 = $29;
  }
  if ($end_2 >>> 0 > $i_0 >>> 0) {
    var $35 = _rndr_newbuf($rndr, 1);
    var $36 = $data + $i_0 | 0;
    _parse_inline($35, $rndr, $36, $end_2 - $i_0 | 0);
    var $39 = HEAP32[$rndr + 12 >> 2];
    if (($39 | 0) != 0) {
      var $43 = HEAP32[$rndr + 104 >> 2];
      FUNCTION_TABLE[$39]($ob, $35, $level_0, $43);
    }
    _rndr_popbuf($rndr, 1);
  }
  return $end_0;
  return null;
}

_parse_atxheader["X"] = 1;

function _parse_htmlblock($ob, $rndr, $data, $size, $do_render) {
  var $2$s2;
  var $work$s2;
  var $rndr$s2 = $rndr >> 2;
  var __stackBase__ = STACKTOP;
  STACKTOP += 16;
  assert(STACKTOP % 4 == 0, "Stack is unaligned");
  assert(STACKTOP < STACK_MAX, "Ran out of stack");
  var $work = __stackBase__, $work$s2 = $work >> 2;
  HEAP32[$work$s2] = $data;
  var $2$s2 = ($work + 4 | 0) >> 2;
  HEAP32[$2$s2] = 0;
  HEAP32[$work$s2 + 2] = 0;
  HEAP32[$work$s2 + 3] = 0;
  var $5 = $size >>> 0 < 2;
  $_$107 : do {
    if ($5) {
      var $_0 = 0;
    } else {
      if (HEAP8[$data] << 24 >> 24 != 60) {
        var $_0 = 0;
        break;
      }
      var $i_0 = 1;
      while (1) {
        var $i_0;
        if ($i_0 >>> 0 >= $size >>> 0) {
          break;
        }
        var $12 = HEAP8[$data + $i_0 | 0];
        if ($12 << 24 >> 24 == 62 || $12 << 24 >> 24 == 32) {
          var $15 = $data + 1 | 0;
          var $17 = _find_block_tag($15, $i_0 - 1 | 0);
          if (($17 | 0) == 0) {
            break;
          }
          var $96 = _htmlblock_end($17, $data, $size, 1);
          if (($96 | 0) == 0) {
            var $99 = _strcmp($17, STRING_TABLE.__str22 | 0);
            if (($99 | 0) == 0) {
              var $_0 = 0;
              break $_$107;
            }
            var $102 = _strcmp($17, STRING_TABLE.__str7 | 0);
            if (($102 | 0) == 0) {
              var $_0 = 0;
              break $_$107;
            }
            var $105 = _htmlblock_end($17, $data, $size, 0);
            if (($105 | 0) == 0) {
              var $_0 = 0;
              break $_$107;
            }
            var $tag_end_07 = $105;
          } else {
            var $tag_end_07 = $96;
          }
          var $tag_end_07;
          HEAP32[$2$s2] = $tag_end_07;
          if (($do_render | 0) == 0) {
            var $_0 = $tag_end_07;
            break $_$107;
          }
          var $110 = HEAP32[$rndr$s2 + 2];
          if (($110 | 0) == 0) {
            var $_0 = $tag_end_07;
            break $_$107;
          }
          var $114 = HEAP32[$rndr$s2 + 26];
          FUNCTION_TABLE[$110]($ob, $work, $114);
          var $_0 = $tag_end_07;
          break $_$107;
        }
        var $i_0 = $i_0 + 1 | 0;
      }
      var $19 = $size >>> 0 > 5;
      do {
        if ($19) {
          if (HEAP8[$data + 1 | 0] << 24 >> 24 != 33) {
            break;
          }
          if (HEAP8[$data + 2 | 0] << 24 >> 24 != 45) {
            break;
          }
          if (HEAP8[$data + 3 | 0] << 24 >> 24 != 45) {
            break;
          }
          var $i_1 = 5;
          $_$128 : while (1) {
            var $i_1;
            if ($i_1 >>> 0 >= $size >>> 0) {
              var $i_2 = $i_1 + 1 | 0;
              break;
            }
            var $37 = HEAP8[$data + ($i_1 - 2) | 0] << 24 >> 24 == 45;
            do {
              if ($37) {
                if (HEAP8[$data + ($i_1 - 1) | 0] << 24 >> 24 != 45) {
                  break;
                }
                var $47 = $i_1 + 1 | 0;
                if (HEAP8[$data + $i_1 | 0] << 24 >> 24 == 62) {
                  var $i_2 = $47;
                  break $_$128;
                }
                var $i_1 = $47;
                continue $_$128;
              }
            } while (0);
            var $i_1 = $i_1 + 1 | 0;
          }
          var $i_2;
          if ($i_2 >>> 0 >= $size >>> 0) {
            break;
          }
          var $51 = $data + $i_2 | 0;
          var $52 = $size - $i_2 | 0;
          var $53 = _is_empty($51, $52);
          if (($53 | 0) == 0) {
            break;
          }
          var $56 = $53 + $i_2 | 0;
          HEAP32[$2$s2] = $56;
          if (($do_render | 0) == 0) {
            var $_0 = $56;
            break $_$107;
          }
          var $60 = HEAP32[$rndr$s2 + 2];
          if (($60 | 0) == 0) {
            var $_0 = $56;
            break $_$107;
          }
          var $64 = HEAP32[$rndr$s2 + 26];
          FUNCTION_TABLE[$60]($ob, $work, $64);
          var $_0 = HEAP32[$2$s2];
          break $_$107;
        }
      } while (0);
      if ($size >>> 0 <= 4) {
        var $_0 = 0;
        break;
      }
      var $68 = HEAP8[$data + 1 | 0];
      if (!($68 << 24 >> 24 == 104 || $68 << 24 >> 24 == 72)) {
        var $_0 = 0;
        break;
      }
      var $70 = HEAP8[$data + 2 | 0];
      if (!($70 << 24 >> 24 == 114 || $70 << 24 >> 24 == 82)) {
        var $_0 = 0;
        break;
      }
      var $i_3 = 3;
      while (1) {
        var $i_3;
        if ($i_3 >>> 0 >= $size >>> 0) {
          var $78 = $i_3 + 1 | 0;
          break;
        }
        var $77 = $i_3 + 1 | 0;
        if (HEAP8[$data + $i_3 | 0] << 24 >> 24 == 62) {
          var $78 = $77;
          break;
        }
        var $i_3 = $77;
      }
      var $78;
      if ($78 >>> 0 >= $size >>> 0) {
        var $_0 = 0;
        break;
      }
      var $81 = $data + $78 | 0;
      var $82 = $size - $78 | 0;
      var $83 = _is_empty($81, $82);
      if (($83 | 0) == 0) {
        var $_0 = 0;
        break;
      }
      var $86 = $83 + $78 | 0;
      HEAP32[$2$s2] = $86;
      if (($do_render | 0) == 0) {
        var $_0 = $86;
        break;
      }
      var $90 = HEAP32[$rndr$s2 + 2];
      if (($90 | 0) == 0) {
        var $_0 = $86;
        break;
      }
      var $94 = HEAP32[$rndr$s2 + 26];
      FUNCTION_TABLE[$90]($ob, $work, $94);
      var $_0 = HEAP32[$2$s2];
    }
  } while (0);
  var $_0;
  STACKTOP = __stackBase__;
  return $_0;
  return null;
}

_parse_htmlblock["X"] = 1;

function _parse_fencedcode($ob, $rndr, $data, $size) {
  var $6$s2;
  var $1$s2;
  var __stackBase__ = STACKTOP;
  STACKTOP += 32;
  assert(STACKTOP % 4 == 0, "Stack is unaligned");
  assert(STACKTOP < STACK_MAX, "Ran out of stack");
  var __label__;
  var $lang = __stackBase__;
  var $fence_trail = __stackBase__ + 16;
  var $1$s2 = $lang >> 2;
  HEAP32[$1$s2] = 0;
  HEAP32[$1$s2 + 1] = 0;
  HEAP32[$1$s2 + 2] = 0;
  HEAP32[$1$s2 + 3] = 0;
  var $2 = _is_codefence($data, $size, $lang);
  if (($2 | 0) == 0) {
    var $_0 = 0;
  } else {
    var $5 = _rndr_newbuf($rndr, 0);
    var $6$s2 = $fence_trail >> 2;
    var $7 = $fence_trail + 4 | 0;
    var $beg_0 = $2;
    $_$185 : while (1) {
      var $beg_0;
      if ($beg_0 >>> 0 >= $size >>> 0) {
        var $beg_1 = $beg_0;
        break;
      }
      HEAP32[$6$s2] = 0;
      HEAP32[$6$s2 + 1] = 0;
      HEAP32[$6$s2 + 2] = 0;
      HEAP32[$6$s2 + 3] = 0;
      var $10 = $data + $beg_0 | 0;
      var $11 = $size - $beg_0 | 0;
      var $12 = _is_codefence($10, $11, $fence_trail);
      var $13 = ($12 | 0) == 0;
      do {
        if (!$13) {
          if ((HEAP32[$7 >> 2] | 0) != 0) {
            var $end_0_in = $beg_0;
            break;
          }
          var $beg_1 = $12 + $beg_0 | 0;
          break $_$185;
        }
        var $end_0_in = $beg_0;
        __label__ = 8;
      } while (0);
      while (1) {
        var $end_0_in;
        var $end_0 = $end_0_in + 1 | 0;
        if ($end_0 >>> 0 >= $size >>> 0) {
          break;
        }
        if (HEAP8[$data + $end_0_in | 0] << 24 >> 24 == 10) {
          break;
        }
        var $end_0_in = $end_0;
      }
      if ($beg_0 >>> 0 >= $end_0 >>> 0) {
        var $beg_0 = $end_0;
        continue;
      }
      var $26 = $end_0 - $beg_0 | 0;
      var $27 = _is_empty($10, $26);
      if (($27 | 0) == 0) {
        _bufput($5, $10, $26);
        var $beg_0 = $end_0;
      } else {
        _bufputc($5, 10);
        var $beg_0 = $end_0;
      }
    }
    var $beg_1;
    var $32 = HEAP32[$5 + 4 >> 2];
    var $33 = ($32 | 0) == 0;
    do {
      if (!$33) {
        if (HEAP8[HEAP32[$5 >> 2] + ($32 - 1) | 0] << 24 >> 24 == 10) {
          break;
        }
        _bufputc($5, 10);
      }
    } while (0);
    var $44 = HEAP32[$rndr >> 2];
    if (($44 | 0) != 0) {
      var $lang_ = (HEAP32[$lang + 4 >> 2] | 0) != 0 ? $lang : 0;
      var $51 = HEAP32[$rndr + 104 >> 2];
      FUNCTION_TABLE[$44]($ob, $5, $lang_, $51);
    }
    _rndr_popbuf($rndr, 0);
    var $_0 = $beg_1;
  }
  var $_0;
  STACKTOP = __stackBase__;
  return $_0;
  return null;
}

_parse_fencedcode["X"] = 1;

function _parse_table($ob, $rndr, $data, $size) {
  var $col_data$s2;
  var __stackBase__ = STACKTOP;
  STACKTOP += 8;
  assert(STACKTOP % 4 == 0, "Stack is unaligned");
  assert(STACKTOP < STACK_MAX, "Ran out of stack");
  var $columns = __stackBase__;
  var $col_data = __stackBase__ + 4, $col_data$s2 = $col_data >> 2;
  HEAP32[$col_data$s2] = 0;
  var $1 = _rndr_newbuf($rndr, 1);
  var $2 = _rndr_newbuf($rndr, 0);
  var $3 = _parse_table_header($1, $rndr, $data, $size, $columns, $col_data);
  var $4 = ($3 | 0) == 0;
  do {
    if ($4) {
      var $i_3 = 0;
      var $32 = HEAP32[$col_data$s2];
    } else {
      var $5 = HEAP32[$columns >> 2];
      var $6 = HEAP32[$col_data$s2];
      var $i_0 = $3;
      while (1) {
        var $i_0;
        if ($i_0 >>> 0 >= $size >>> 0) {
          break;
        }
        var $pipes_0 = 0;
        var $i_1 = $i_0;
        while (1) {
          var $i_1;
          var $pipes_0;
          if ($i_1 >>> 0 >= $size >>> 0) {
            break;
          }
          var $12 = HEAPU8[$data + $i_1 | 0];
          if ($12 << 24 >> 24 == 10) {
            break;
          }
          var $pipes_0 = ($12 << 24 >> 24 == 124 & 1) + $pipes_0 | 0;
          var $i_1 = $i_1 + 1 | 0;
        }
        if (($pipes_0 | 0) == 0 | ($i_1 | 0) == ($size | 0)) {
          break;
        }
        var $21 = $data + $i_0 | 0;
        _parse_table_row($2, $rndr, $21, $i_1 - $i_0 | 0, $5, $6, 0);
        var $i_0 = $i_1 + 1 | 0;
      }
      var $26 = HEAP32[$rndr + 32 >> 2];
      if (($26 | 0) == 0) {
        var $i_3 = $i_0;
        var $32 = $6;
        break;
      }
      var $30 = HEAP32[$rndr + 104 >> 2];
      FUNCTION_TABLE[$26]($ob, $1, $2, $30);
      var $i_3 = $i_0;
      var $32 = $6;
    }
  } while (0);
  var $32;
  var $i_3;
  _free($32);
  _rndr_popbuf($rndr, 1);
  _rndr_popbuf($rndr, 0);
  STACKTOP = __stackBase__;
  return $i_3;
  return null;
}

_parse_table["X"] = 1;

function _prefix_quote($data, $size) {
  if (($size | 0) == 0) {
    var $i_0 = 0;
  } else {
    var $i_0 = HEAP8[$data] << 24 >> 24 == 32 & 1;
  }
  var $i_0;
  if ($i_0 >>> 0 < $size >>> 0) {
    var $i_1 = (HEAP8[$data + $i_0 | 0] << 24 >> 24 == 32 & 1) + $i_0 | 0;
  } else {
    var $i_1 = $i_0;
  }
  var $i_1;
  if ($i_1 >>> 0 < $size >>> 0) {
    var $i_2 = (HEAP8[$data + $i_1 | 0] << 24 >> 24 == 32 & 1) + $i_1 | 0;
  } else {
    var $i_2 = $i_1;
  }
  var $i_2;
  var $20 = $i_2 >>> 0 < $size >>> 0;
  do {
    if ($20) {
      if (HEAP8[$data + $i_2 | 0] << 24 >> 24 != 62) {
        var $_0 = 0;
        break;
      }
      var $26 = $i_2 + 1 | 0;
      if ($26 >>> 0 >= $size >>> 0) {
        var $_0 = $26;
        break;
      }
      var $_1 = HEAP8[$data + $26 | 0] << 24 >> 24 == 32 ? $i_2 + 2 | 0 : $26;
      return $_1;
    } else {
      var $_0 = 0;
    }
  } while (0);
  var $_0;
  return $_0;
  return null;
}

function _prefix_code($data, $size) {
  var __label__;
  var $1 = $size >>> 0 > 3;
  do {
    if ($1) {
      if (HEAP8[$data] << 24 >> 24 != 32) {
        __label__ = 7;
        break;
      }
      if (HEAP8[$data + 1 | 0] << 24 >> 24 != 32) {
        __label__ = 7;
        break;
      }
      if (HEAP8[$data + 2 | 0] << 24 >> 24 != 32) {
        __label__ = 7;
        break;
      }
      if (HEAP8[$data + 3 | 0] << 24 >> 24 == 32) {
        var $_0 = 4;
        __label__ = 8;
        break;
      }
      __label__ = 7;
      break;
    } else {
      __label__ = 7;
    }
  } while (0);
  if (__label__ == 7) {
    var $_0 = 0;
  }
  var $_0;
  return $_0;
  return null;
}

function _is_headerline($data, $size) {
  var $1 = HEAP8[$data];
  $_$169 : do {
    if ($1 << 24 >> 24 == 61) {
      var $i_0 = 1;
      while (1) {
        var $i_0;
        if ($i_0 >>> 0 >= $size >>> 0) {
          var $i_1 = $i_0;
          break;
        }
        if (HEAP8[$data + $i_0 | 0] << 24 >> 24 != 61) {
          var $i_1 = $i_0;
          break;
        }
        var $i_0 = $i_0 + 1 | 0;
      }
      while (1) {
        var $i_1;
        if ($i_1 >>> 0 >= $size >>> 0) {
          var $16 = 1;
          break;
        }
        var $11 = HEAPU8[$data + $i_1 | 0];
        if ($11 << 24 >> 24 == 32) {
          var $i_1 = $i_1 + 1 | 0;
          continue;
        }
        var $16 = $11 << 24 >> 24 == 10;
        break;
      }
      var $16;
      var $_0 = $16 & 1;
    } else if ($1 << 24 >> 24 == 45) {
      var $i_2 = 1;
      while (1) {
        var $i_2;
        if ($i_2 >>> 0 >= $size >>> 0) {
          var $i_3 = $i_2;
          break;
        }
        if (HEAP8[$data + $i_2 | 0] << 24 >> 24 != 45) {
          var $i_3 = $i_2;
          break;
        }
        var $i_2 = $i_2 + 1 | 0;
      }
      while (1) {
        var $i_3;
        if ($i_3 >>> 0 >= $size >>> 0) {
          var $_0 = 2;
          break $_$169;
        }
        var $27 = HEAPU8[$data + $i_3 | 0];
        if ($27 << 24 >> 24 != 32) {
          break;
        }
        var $i_3 = $i_3 + 1 | 0;
      }
      var $phitmp = $27 << 24 >> 24 == 10 ? 2 : 0;
      var $_0 = $phitmp;
    } else {
      var $_0 = 0;
    }
  } while (0);
  var $_0;
  return $_0;
  return null;
}

function _parse_blockquote($ob, $rndr, $data, $size) {
  var $1 = _rndr_newbuf($rndr, 0);
  var $work_data_0_ph = 0;
  var $work_size_0_ph = 0;
  var $beg_0_ph = 0;
  $_$17 : while (1) {
    var $beg_0_ph;
    var $work_size_0_ph;
    var $work_data_0_ph;
    var $beg_0 = $beg_0_ph;
    while (1) {
      var $beg_0;
      if ($beg_0 >>> 0 >= $size >>> 0) {
        var $end_2 = $beg_0;
        break $_$17;
      }
      var $end_1_in = $beg_0;
      while (1) {
        var $end_1_in;
        var $end_1 = $end_1_in + 1 | 0;
        if ($end_1 >>> 0 >= $size >>> 0) {
          var $_lcssa = 0;
          break;
        }
        if (HEAP8[$data + $end_1_in | 0] << 24 >> 24 == 10) {
          var $_lcssa = 1;
          break;
        }
        var $end_1_in = $end_1;
      }
      var $_lcssa;
      var $9 = $data + $beg_0 | 0;
      var $10 = $end_1 - $beg_0 | 0;
      var $11 = _prefix_quote($9, $10);
      var $12 = ($11 | 0) == 0;
      do {
        if ($12) {
          var $16 = _is_empty($9, $10);
          if (($16 | 0) == 0) {
            var $beg_1 = $beg_0;
            break;
          }
          if (!$_lcssa) {
            var $end_2 = $end_1;
            break $_$17;
          }
          var $20 = $data + $end_1 | 0;
          var $21 = $size - $end_1 | 0;
          var $22 = _prefix_quote($20, $21);
          if (($22 | 0) != 0) {
            var $beg_1 = $beg_0;
            break;
          }
          var $25 = _is_empty($20, $21);
          if (($25 | 0) == 0) {
            var $end_2 = $end_1;
            break $_$17;
          }
          var $beg_1 = $beg_0;
        } else {
          var $beg_1 = $11 + $beg_0 | 0;
        }
      } while (0);
      var $beg_1;
      if ($beg_1 >>> 0 < $end_1 >>> 0) {
        break;
      }
      var $beg_0 = $end_1;
    }
    var $30 = ($work_data_0_ph | 0) == 0;
    var $31 = $data + $beg_1 | 0;
    do {
      if ($30) {
        var $work_data_1 = $31;
      } else {
        var $33 = $work_data_0_ph + $work_size_0_ph | 0;
        if (($31 | 0) == ($33 | 0)) {
          var $work_data_1 = $work_data_0_ph;
          break;
        }
        _llvm_memmove_p0i8_p0i8_i32($33, $31, $end_1 - $beg_1 | 0, 1, 0);
        var $work_data_1 = $work_data_0_ph;
      }
    } while (0);
    var $work_data_1;
    var $work_data_0_ph = $work_data_1;
    var $work_size_0_ph = $end_1 + $work_size_0_ph - $beg_1 | 0;
    var $beg_0_ph = $end_1;
  }
  var $end_2;
  _parse_block($1, $rndr, $work_data_0_ph, $work_size_0_ph);
  var $42 = HEAP32[$rndr + 4 >> 2];
  if (($42 | 0) != 0) {
    var $46 = HEAP32[$rndr + 104 >> 2];
    FUNCTION_TABLE[$42]($ob, $1, $46);
  }
  _rndr_popbuf($rndr, 0);
  return $end_2;
  return null;
}

_parse_blockquote["X"] = 1;

function _parse_blockcode($ob, $rndr, $data, $size) {
  var $1 = _rndr_newbuf($rndr, 0);
  var $beg_0 = 0;
  while (1) {
    var $beg_0;
    if ($beg_0 >>> 0 >= $size >>> 0) {
      break;
    }
    var $end_0_in = $beg_0;
    while (1) {
      var $end_0_in;
      var $end_0 = $end_0_in + 1 | 0;
      if ($end_0 >>> 0 >= $size >>> 0) {
        break;
      }
      if (HEAP8[$data + $end_0_in | 0] << 24 >> 24 == 10) {
        break;
      }
      var $end_0_in = $end_0;
    }
    var $8 = $data + $beg_0 | 0;
    var $9 = $end_0 - $beg_0 | 0;
    var $10 = _prefix_code($8, $9);
    if (($10 | 0) == 0) {
      var $15 = _is_empty($8, $9);
      if (($15 | 0) == 0) {
        break;
      }
      var $beg_1 = $beg_0;
    } else {
      var $beg_1 = $10 + $beg_0 | 0;
    }
    var $beg_1;
    if ($beg_1 >>> 0 >= $end_0 >>> 0) {
      var $beg_0 = $end_0;
      continue;
    }
    var $22 = $data + $beg_1 | 0;
    var $23 = $end_0 - $beg_1 | 0;
    var $24 = _is_empty($22, $23);
    if (($24 | 0) == 0) {
      _bufput($1, $22, $23);
      var $beg_0 = $end_0;
    } else {
      _bufputc($1, 10);
      var $beg_0 = $end_0;
    }
  }
  var $17 = $1 + 4 | 0;
  var $18 = $1 | 0;
  var $29 = HEAP32[$17 >> 2];
  while (1) {
    var $29;
    if (($29 | 0) == 0) {
      break;
    }
    var $32 = $29 - 1 | 0;
    if (HEAP8[HEAP32[$18 >> 2] + $32 | 0] << 24 >> 24 != 10) {
      break;
    }
    HEAP32[$17 >> 2] = $32;
    var $29 = $32;
  }
  _bufputc($1, 10);
  var $39 = HEAP32[$rndr >> 2];
  if (($39 | 0) != 0) {
    var $43 = HEAP32[$rndr + 104 >> 2];
    FUNCTION_TABLE[$39]($ob, $1, 0, $43);
  }
  _rndr_popbuf($rndr, 0);
  return $beg_0;
  return null;
}

_parse_blockcode["X"] = 1;

function _prefix_uli($data, $size) {
  if (($size | 0) == 0) {
    var $i_0 = 0;
  } else {
    var $i_0 = HEAP8[$data] << 24 >> 24 == 32 & 1;
  }
  var $i_0;
  if ($i_0 >>> 0 < $size >>> 0) {
    var $i_1 = (HEAP8[$data + $i_0 | 0] << 24 >> 24 == 32 & 1) + $i_0 | 0;
  } else {
    var $i_1 = $i_0;
  }
  var $i_1;
  if ($i_1 >>> 0 < $size >>> 0) {
    var $i_2 = (HEAP8[$data + $i_1 | 0] << 24 >> 24 == 32 & 1) + $i_1 | 0;
  } else {
    var $i_2 = $i_1;
  }
  var $i_2;
  var $20 = $i_2 + 1 | 0;
  var $21 = $20 >>> 0 < $size >>> 0;
  do {
    if ($21) {
      var $23 = $data + $i_2 | 0;
      var $24 = HEAP8[$23];
      if (!($24 << 24 >> 24 == 42 || $24 << 24 >> 24 == 43 || $24 << 24 >> 24 == 45)) {
        break;
      }
      if (HEAP8[$data + $20 | 0] << 24 >> 24 != 32) {
        break;
      }
      var $30 = $size - $i_2 | 0;
      var $31 = _is_next_headerline($23, $30);
      var $_1 = ($31 | 0) == 0 ? $i_2 + 2 | 0 : 0;
      return $_1;
    }
  } while (0);
  return 0;
  return null;
}

function _parse_list($ob, $rndr, $data, $size, $flags) {
  var $1$s2;
  var __stackBase__ = STACKTOP;
  STACKTOP += 4;
  assert(STACKTOP % 4 == 0, "Stack is unaligned");
  assert(STACKTOP < STACK_MAX, "Ran out of stack");
  var $1 = __stackBase__, $1$s2 = $1 >> 2;
  HEAP32[$1$s2] = $flags;
  var $2 = _rndr_newbuf($rndr, 0);
  var $i_0 = 0;
  while (1) {
    var $i_0;
    if ($i_0 >>> 0 >= $size >>> 0) {
      var $i_1 = $i_0;
      break;
    }
    var $6 = $data + $i_0 | 0;
    var $7 = $size - $i_0 | 0;
    var $8 = _parse_listitem($2, $rndr, $6, $7, $1);
    var $9 = $8 + $i_0 | 0;
    if (($8 | 0) == 0) {
      var $i_1 = $9;
      break;
    }
    if ((HEAP32[$1$s2] & 8 | 0) != 0) {
      var $i_1 = $9;
      break;
    }
    var $i_0 = $9;
  }
  var $i_1;
  var $17 = HEAP32[$rndr + 20 >> 2];
  if (($17 | 0) != 0) {
    var $20 = HEAP32[$1$s2];
    var $22 = HEAP32[$rndr + 104 >> 2];
    FUNCTION_TABLE[$17]($ob, $2, $20, $22);
  }
  _rndr_popbuf($rndr, 0);
  STACKTOP = __stackBase__;
  return $i_1;
  return null;
}

function _prefix_oli($data, $size) {
  if (($size | 0) == 0) {
    var $i_0 = 0;
  } else {
    var $i_0 = HEAP8[$data] << 24 >> 24 == 32 & 1;
  }
  var $i_0;
  if ($i_0 >>> 0 < $size >>> 0) {
    var $i_1 = (HEAP8[$data + $i_0 | 0] << 24 >> 24 == 32 & 1) + $i_0 | 0;
  } else {
    var $i_1 = $i_0;
  }
  var $i_1;
  if ($i_1 >>> 0 < $size >>> 0) {
    var $i_2 = (HEAP8[$data + $i_1 | 0] << 24 >> 24 == 32 & 1) + $i_1 | 0;
  } else {
    var $i_2 = $i_1;
  }
  var $i_2;
  var $20 = $i_2 >>> 0 < $size >>> 0;
  do {
    if ($20) {
      if ((HEAP8[$data + $i_2 | 0] - 48 & 255 & 255) > 9) {
        break;
      }
      var $i_3 = $i_2;
      while (1) {
        var $i_3;
        if ($i_3 >>> 0 >= $size >>> 0) {
          var $32 = $i_3 + 1 | 0;
          break;
        }
        var $31 = $i_3 + 1 | 0;
        if ((HEAP8[$data + $i_3 | 0] - 48 & 255 & 255) >= 10) {
          var $32 = $31;
          break;
        }
        var $i_3 = $31;
      }
      var $32;
      if ($32 >>> 0 >= $size >>> 0) {
        break;
      }
      var $35 = $data + $i_3 | 0;
      if (HEAP8[$35] << 24 >> 24 != 46) {
        break;
      }
      if (HEAP8[$data + $32 | 0] << 24 >> 24 != 32) {
        break;
      }
      var $43 = $size - $i_3 | 0;
      var $44 = _is_next_headerline($35, $43);
      var $_2 = ($44 | 0) == 0 ? $i_3 + 2 | 0 : 0;
      return $_2;
    }
  } while (0);
  return 0;
  return null;
}

_prefix_oli["X"] = 1;

function _parse_paragraph($ob, $rndr, $data, $size) {
  var $rndr$s2 = $rndr >> 2;
  var $1 = $rndr + 420 | 0;
  var $2 = $rndr + 8 | 0;
  var $i_0 = 0;
  $_$121 : while (1) {
    var $i_0;
    if ($i_0 >>> 0 >= $size >>> 0) {
      var $level_1 = 0;
      var $end_2 = $i_0;
      break;
    }
    var $end_1_in = $i_0;
    while (1) {
      var $end_1_in;
      var $end_1 = $end_1_in + 1 | 0;
      if ($end_1 >>> 0 >= $size >>> 0) {
        break;
      }
      if (HEAP8[$data + $end_1_in | 0] << 24 >> 24 == 10) {
        break;
      }
      var $end_1_in = $end_1;
    }
    var $9 = $data + $i_0 | 0;
    var $10 = $size - $i_0 | 0;
    var $11 = _is_empty($9, $10);
    if (($11 | 0) != 0) {
      var $level_1 = 0;
      var $end_2 = $end_1;
      break;
    }
    var $14 = _is_headerline($9, $10);
    if (($14 | 0) != 0) {
      var $level_1 = $14;
      var $end_2 = $end_1;
      break;
    }
    var $17 = _is_atxheader($rndr, $9, $10);
    if (($17 | 0) != 0) {
      var $level_1 = 0;
      var $end_2 = $i_0;
      break;
    }
    var $20 = _is_hrule($9, $10);
    if (($20 | 0) != 0) {
      var $level_1 = 0;
      var $end_2 = $i_0;
      break;
    }
    var $23 = _prefix_quote($9, $10);
    if (($23 | 0) != 0) {
      var $level_1 = 0;
      var $end_2 = $i_0;
      break;
    }
    if ((HEAP32[$1 >> 2] & 256 | 0) == 0) {
      var $i_0 = $end_1;
      continue;
    }
    var $31 = HEAPU8[$9] & 255;
    var $32 = _isalnum($31);
    if (($32 | 0) != 0) {
      var $i_0 = $end_1;
      continue;
    }
    var $35 = _prefix_oli($9, $10);
    if (($35 | 0) != 0) {
      var $level_1 = 0;
      var $end_2 = $i_0;
      break;
    }
    var $38 = _prefix_uli($9, $10);
    if (($38 | 0) != 0) {
      var $level_1 = 0;
      var $end_2 = $i_0;
      break;
    }
    var $42 = HEAP8[$9] << 24 >> 24 == 60;
    do {
      if ($42) {
        if ((HEAP32[$2 >> 2] | 0) == 0) {
          break;
        }
        var $47 = _parse_htmlblock($ob, $rndr, $9, $10, 0);
        if (($47 | 0) != 0) {
          var $level_1 = 0;
          var $end_2 = $i_0;
          break $_$121;
        }
      }
    } while (0);
    if ((HEAP32[$1 >> 2] & 4 | 0) == 0) {
      var $i_0 = $end_1;
      continue;
    }
    var $54 = _is_codefence($9, $10, 0);
    if (($54 | 0) != 0) {
      var $level_1 = 0;
      var $end_2 = $i_0;
      break;
    }
    var $i_0 = $end_1;
  }
  var $end_2;
  var $level_1;
  var $work_1_0 = $i_0;
  while (1) {
    var $work_1_0;
    if (($work_1_0 | 0) == 0) {
      var $_lcssa = 0;
      break;
    }
    var $60 = $work_1_0 - 1 | 0;
    if (HEAP8[$data + $60 | 0] << 24 >> 24 != 10) {
      var $_lcssa = 1;
      break;
    }
    var $work_1_0 = $60;
  }
  var $_lcssa;
  if (($level_1 | 0) == 0) {
    var $66 = _rndr_newbuf($rndr, 0);
    _parse_inline($66, $rndr, $data, $work_1_0);
    var $68 = HEAP32[$rndr$s2 + 7];
    if (($68 | 0) != 0) {
      var $72 = HEAP32[$rndr$s2 + 26];
      FUNCTION_TABLE[$68]($ob, $66, $72);
    }
    _rndr_popbuf($rndr, 0);
  } else {
    $_$152 : do {
      if ($_lcssa) {
        var $work_1_1_in = $work_1_0;
        while (1) {
          var $work_1_1_in;
          var $work_1_1 = $work_1_1_in - 1 | 0;
          if (($work_1_1 | 0) == 0) {
            var $work_1_2 = 0;
            break;
          }
          if (HEAP8[$data + $work_1_1 | 0] << 24 >> 24 == 10) {
            var $work_1_2 = $work_1_1;
            break;
          }
          var $work_1_1_in = $work_1_1;
        }
        while (1) {
          var $work_1_2;
          if (($work_1_2 | 0) == 0) {
            var $work_0_0 = $data;
            var $work_1_3 = $work_1_0;
            break $_$152;
          }
          var $81 = $work_1_2 - 1 | 0;
          if (HEAP8[$data + $81 | 0] << 24 >> 24 != 10) {
            break;
          }
          var $work_1_2 = $81;
        }
        var $85 = _rndr_newbuf($rndr, 0);
        _parse_inline($85, $rndr, $data, $work_1_2);
        var $87 = HEAP32[$rndr$s2 + 7];
        if (($87 | 0) != 0) {
          var $91 = HEAP32[$rndr$s2 + 26];
          FUNCTION_TABLE[$87]($ob, $85, $91);
        }
        _rndr_popbuf($rndr, 0);
        var $work_0_0 = $data + $work_1_1_in | 0;
        var $work_1_3 = $work_1_0 - $work_1_1_in | 0;
      } else {
        var $work_0_0 = $data;
        var $work_1_3 = 0;
      }
    } while (0);
    var $work_1_3;
    var $work_0_0;
    var $95 = _rndr_newbuf($rndr, 1);
    _parse_inline($95, $rndr, $work_0_0, $work_1_3);
    var $97 = HEAP32[$rndr$s2 + 3];
    if (($97 | 0) != 0) {
      var $101 = HEAP32[$rndr$s2 + 26];
      FUNCTION_TABLE[$97]($ob, $95, $level_1, $101);
    }
    _rndr_popbuf($rndr, 1);
  }
  return $end_2;
  return null;
}

_parse_paragraph["X"] = 1;

function _is_codefence($data, $size, $syntax) {
  var __label__;
  var $1 = _prefix_codefence($data, $size);
  var $2 = ($1 | 0) == 0;
  $_$187 : do {
    if ($2) {
      var $_0 = 0;
    } else {
      var $i_0 = $1;
      while (1) {
        var $i_0;
        var $4 = $data + $i_0 | 0;
        if ($i_0 >>> 0 >= $size >>> 0) {
          var $syn_len_3 = 0;
          var $i_2 = $i_0;
          __label__ = 17;
          break;
        }
        var $6 = HEAP8[$4];
        var $7 = $i_0 + 1 | 0;
        if ($6 << 24 >> 24 == 32) {
          var $i_0 = $7;
        } else if ($6 << 24 >> 24 == 123) {
          __label__ = 5;
          break;
        } else {
          var $syn_len_3 = 0;
          var $i_2 = $i_0;
          __label__ = 17;
          break;
        }
      }
      $_$191 : do {
        if (__label__ == 5) {
          var $9 = $data + $7 | 0;
          var $syn_len_0 = 0;
          var $i_1_in = $i_0;
          while (1) {
            var $i_1_in;
            var $syn_len_0;
            var $i_1 = $i_1_in + 1 | 0;
            if ($i_1 >>> 0 >= $size >>> 0) {
              break;
            }
            var $14 = HEAP8[$data + $i_1 | 0];
            if ($14 << 24 >> 24 == 125 || $14 << 24 >> 24 == 10) {
              break;
            }
            var $syn_len_0 = $syn_len_0 + 1 | 0;
            var $i_1_in = $i_1;
          }
          if (($i_1 | 0) == ($size | 0)) {
            var $_0 = 0;
            break $_$187;
          }
          if (HEAP8[$data + $i_1 | 0] << 24 >> 24 != 125) {
            var $_0 = 0;
            break $_$187;
          }
          var $syn_start_0 = $9;
          var $syn_len_1 = $syn_len_0;
          while (1) {
            var $syn_len_1;
            var $syn_start_0;
            if (($syn_len_1 | 0) == 0) {
              var $syn_len_2 = 0;
              break;
            }
            var $25 = HEAPU8[$syn_start_0] & 255;
            var $26 = __isspace($25);
            if (($26 | 0) == 0) {
              var $syn_len_2 = $syn_len_1;
              break;
            }
            var $syn_start_0 = $syn_start_0 + 1 | 0;
            var $syn_len_1 = $syn_len_1 - 1 | 0;
          }
          while (1) {
            var $syn_len_2;
            if (($syn_len_2 | 0) == 0) {
              break;
            }
            var $33 = $syn_len_2 - 1 | 0;
            var $36 = HEAPU8[$syn_start_0 + $33 | 0] & 255;
            var $37 = __isspace($36);
            if (($37 | 0) == 0) {
              break;
            }
            var $syn_len_2 = $33;
          }
          var $syn_start_1 = $syn_start_0;
          var $syn_len_4 = $syn_len_2;
          var $i_3 = $i_1_in + 2 | 0;
        } else if (__label__ == 17) {
          while (1) {
            var $i_2;
            var $syn_len_3;
            if ($i_2 >>> 0 >= $size >>> 0) {
              var $syn_start_1 = $4;
              var $syn_len_4 = $syn_len_3;
              var $i_3 = $i_2;
              break $_$191;
            }
            var $44 = HEAPU8[$data + $i_2 | 0] & 255;
            var $45 = __isspace($44);
            if (($45 | 0) != 0) {
              var $syn_start_1 = $4;
              var $syn_len_4 = $syn_len_3;
              var $i_3 = $i_2;
              break $_$191;
            }
            var $syn_len_3 = $syn_len_3 + 1 | 0;
            var $i_2 = $i_2 + 1 | 0;
          }
        }
      } while (0);
      var $i_3;
      var $syn_len_4;
      var $syn_start_1;
      if (($syntax | 0) == 0) {
        var $i_4 = $i_3;
        __label__ = 22;
      } else {
        HEAP32[$syntax >> 2] = $syn_start_1;
        HEAP32[$syntax + 4 >> 2] = $syn_len_4;
        var $i_4 = $i_3;
      }
      while (1) {
        var $i_4;
        if ($i_4 >>> 0 >= $size >>> 0) {
          break;
        }
        var $57 = HEAPU8[$data + $i_4 | 0];
        if ($57 << 24 >> 24 == 10) {
          break;
        }
        var $60 = $57 & 255;
        var $61 = __isspace($60);
        if (($61 | 0) == 0) {
          var $_0 = 0;
          break $_$187;
        }
        var $i_4 = $i_4 + 1 | 0;
      }
      var $_0 = $i_4 + 1 | 0;
    }
  } while (0);
  var $_0;
  return $_0;
  return null;
}

_is_codefence["X"] = 1;

function _rndr_newbuf($rndr, $type) {
  var __label__;
  var $1 = $rndr + $type * 12 + 396 | 0;
  var $2 = $rndr + $type * 12 + 400 | 0;
  var $3 = HEAPU32[$2 >> 2];
  var $6 = $3 >>> 0 < HEAPU32[($rndr + 404 >> 2) + ($type * 3 | 0)] >>> 0;
  do {
    if ($6) {
      var $10 = ($3 << 2) + HEAP32[$1 >> 2] | 0;
      if ((HEAP32[$10 >> 2] | 0) == 0) {
        __label__ = 5;
        break;
      }
      HEAP32[$2 >> 2] = $3 + 1 | 0;
      var $15 = HEAP32[$10 >> 2];
      var $16 = $15;
      var $18 = $15 + 4 | 0;
      HEAP32[$18 >> 2] = 0;
      var $work_0 = $16;
      __label__ = 6;
      break;
    }
    __label__ = 5;
  } while (0);
  if (__label__ == 5) {
    var $21 = HEAP32[_rndr_newbuf_buf_size + ($type << 2) >> 2];
    var $22 = _bufnew($21);
    var $23 = $22;
    var $24 = _stack_push($1, $23);
    var $work_0 = $22;
  }
  var $work_0;
  return $work_0;
  return null;
}

function _rndr_popbuf($rndr, $type) {
  var $1 = $rndr + $type * 12 + 400 | 0;
  var $3 = HEAP32[$1 >> 2] - 1 | 0;
  HEAP32[$1 >> 2] = $3;
  return;
  return;
}

function _parse_inline($ob, $rndr, $data, $size) {
  var $1$s2;
  var __stackBase__ = STACKTOP;
  STACKTOP += 16;
  assert(STACKTOP % 4 == 0, "Stack is unaligned");
  assert(STACKTOP < STACK_MAX, "Ran out of stack");
  var $work = __stackBase__;
  var $1$s2 = $work >> 2;
  HEAP32[$1$s2] = 0;
  HEAP32[$1$s2 + 1] = 0;
  HEAP32[$1$s2 + 2] = 0;
  HEAP32[$1$s2 + 3] = 0;
  var $9 = (HEAP32[$rndr + 400 >> 2] + HEAP32[$rndr + 412 >> 2] | 0) >>> 0 > HEAPU32[$rndr + 424 >> 2] >>> 0;
  $_$2 : do {
    if (!$9) {
      var $10 = $rndr + 92 | 0;
      var $11 = $work | 0;
      var $12 = $work + 4 | 0;
      var $13 = $rndr + 104 | 0;
      var $action_0 = 0;
      var $end_0 = 0;
      var $i_0 = 0;
      while (1) {
        var $i_0;
        var $end_0;
        var $action_0;
        if ($i_0 >>> 0 >= $size >>> 0) {
          break $_$2;
        }
        var $action_1 = $action_0;
        var $end_1 = $end_0;
        while (1) {
          var $end_1;
          var $action_1;
          if ($end_1 >>> 0 >= $size >>> 0) {
            var $action_2 = $action_1;
            var $_lcssa = 0;
            break;
          }
          var $21 = HEAPU8[$rndr + (HEAPU8[$data + $end_1 | 0] & 255) + 140 | 0];
          if ($21 << 24 >> 24 != 0) {
            var $action_2 = $21;
            var $_lcssa = 1;
            break;
          }
          var $action_1 = 0;
          var $end_1 = $end_1 + 1 | 0;
        }
        var $_lcssa;
        var $action_2;
        var $24 = HEAPU32[$10 >> 2];
        var $26 = $data + $i_0 | 0;
        if (($24 | 0) == 0) {
          _bufput($ob, $26, $end_1 - $i_0 | 0);
        } else {
          HEAP32[$11 >> 2] = $26;
          HEAP32[$12 >> 2] = $end_1 - $i_0 | 0;
          var $29 = HEAP32[$13 >> 2];
          FUNCTION_TABLE[$24]($ob, $work, $29);
        }
        if (!$_lcssa) {
          break $_$2;
        }
        var $36 = HEAP32[_markdown_char_ptrs + (($action_2 & 255) << 2) >> 2];
        var $37 = $data + $end_1 | 0;
        var $38 = $size - $end_1 | 0;
        var $39 = FUNCTION_TABLE[$36]($ob, $rndr, $37, $end_1, $38);
        if (($39 | 0) == 0) {
          var $action_0 = $action_2;
          var $end_0 = $end_1 + 1 | 0;
          var $i_0 = $end_1;
        } else {
          var $44 = $39 + $end_1 | 0;
          var $action_0 = $action_2;
          var $end_0 = $44;
          var $i_0 = $44;
        }
      }
    }
  } while (0);
  STACKTOP = __stackBase__;
  return;
  return;
}

_parse_inline["X"] = 1;

function _char_emphasis($ob, $rndr, $data, $offset, $size) {
  var $1 = HEAPU8[$data];
  var $2 = $size >>> 0 > 2;
  do {
    if ($2) {
      var $4 = $data + 1 | 0;
      var $5 = HEAPU8[$4];
      var $6 = $5 & 255;
      if ($5 << 24 >> 24 == $1 << 24 >> 24) {
        if ($size >>> 0 <= 3) {
          var $_0 = 0;
          break;
        }
        var $21 = $data + 2 | 0;
        var $22 = HEAPU8[$21];
        if ($22 << 24 >> 24 == $1 << 24 >> 24) {
          if ($size >>> 0 <= 4) {
            var $_0 = 0;
            break;
          }
          var $36 = $data + 3 | 0;
          var $37 = HEAPU8[$36];
          if ($37 << 24 >> 24 == $1 << 24 >> 24 | $1 << 24 >> 24 == 126) {
            var $_0 = 0;
            break;
          }
          var $41 = $37 & 255;
          var $42 = __isspace($41);
          if (($42 | 0) != 0) {
            var $_0 = 0;
            break;
          }
          var $45 = $size - 3 | 0;
          var $46 = _parse_emph3($ob, $rndr, $36, $45, $1);
          var $_2 = ($46 | 0) == 0 ? 0 : $46 + 3 | 0;
          var $_0 = $_2;
        } else {
          var $25 = $22 & 255;
          var $26 = __isspace($25);
          if (($26 | 0) != 0) {
            var $_0 = 0;
            break;
          }
          var $29 = $size - 2 | 0;
          var $30 = _parse_emph2($ob, $rndr, $21, $29, $1);
          var $_1 = ($30 | 0) == 0 ? 0 : $30 + 2 | 0;
          var $_0 = $_1;
        }
      } else {
        if ($1 << 24 >> 24 == 126) {
          var $_0 = 0;
          break;
        }
        var $11 = __isspace($6);
        if (($11 | 0) != 0) {
          var $_0 = 0;
          break;
        }
        var $14 = $size - 1 | 0;
        var $15 = _parse_emph1($ob, $rndr, $4, $14, $1);
        var $_ = ($15 | 0) == 0 ? 0 : $15 + 1 | 0;
        return $_;
      }
    } else {
      var $_0 = 0;
    }
  } while (0);
  var $_0;
  return $_0;
  return null;
}

_char_emphasis["X"] = 1;

function _char_codespan($ob, $rndr, $data, $offset, $size) {
  var $work$s2;
  var __stackBase__ = STACKTOP;
  STACKTOP += 16;
  assert(STACKTOP % 4 == 0, "Stack is unaligned");
  assert(STACKTOP < STACK_MAX, "Ran out of stack");
  var __label__;
  var $work = __stackBase__, $work$s2 = $work >> 2;
  var $nb_0 = 0;
  while (1) {
    var $nb_0;
    if ($nb_0 >>> 0 >= $size >>> 0) {
      var $end_0_lcssa = $nb_0;
      var $i_0_lcssa = 0;
      var $_lcssa = 0;
      __label__ = 8;
      break;
    }
    var $5 = HEAPU8[$data + $nb_0 | 0];
    if ($5 << 24 >> 24 != 96) {
      __label__ = 5;
      break;
    }
    var $nb_0 = $nb_0 + 1 | 0;
  }
  $_$41 : do {
    if (__label__ == 5) {
      if (($nb_0 | 0) == 0) {
        var $end_0_lcssa15 = $nb_0;
        __label__ = 9;
        break;
      }
      var $end_07 = $nb_0;
      var $i_08 = 1;
      var $9 = $5;
      while (1) {
        var $9;
        var $i_08;
        var $end_07;
        var $i_1 = $9 << 24 >> 24 == 96 ? $i_08 : 0;
        var $11 = $end_07 + 1 | 0;
        var $12 = $11 >>> 0 < $size >>> 0;
        if (!($12 & $i_1 >>> 0 < $nb_0 >>> 0)) {
          var $end_0_lcssa = $11;
          var $i_0_lcssa = $i_1;
          var $_lcssa = $12;
          __label__ = 8;
          break $_$41;
        }
        var $_pre = HEAP8[$data + $11 | 0];
        var $end_07 = $11;
        var $i_08 = $i_1 + 1 | 0;
        var $9 = $_pre;
      }
    }
  } while (0);
  do {
    if (__label__ == 8) {
      var $_lcssa;
      var $i_0_lcssa;
      var $end_0_lcssa;
      if ($i_0_lcssa >>> 0 >= $nb_0 >>> 0 | $_lcssa) {
        var $end_0_lcssa15 = $end_0_lcssa;
        __label__ = 9;
        break;
      }
      var $_0 = 0;
      __label__ = 18;
      break;
    }
  } while (0);
  if (__label__ == 9) {
    var $end_0_lcssa15;
    var $f_begin_0 = $nb_0;
    while (1) {
      var $f_begin_0;
      if ($f_begin_0 >>> 0 >= $end_0_lcssa15 >>> 0) {
        break;
      }
      if (HEAP8[$data + $f_begin_0 | 0] << 24 >> 24 != 32) {
        break;
      }
      var $f_begin_0 = $f_begin_0 + 1 | 0;
    }
    var $f_end_0 = $end_0_lcssa15 - $nb_0 | 0;
    while (1) {
      var $f_end_0;
      if ($f_end_0 >>> 0 <= $nb_0 >>> 0) {
        break;
      }
      var $26 = $f_end_0 - 1 | 0;
      if (HEAP8[$data + $26 | 0] << 24 >> 24 != 32) {
        break;
      }
      var $f_end_0 = $26;
    }
    if ($f_begin_0 >>> 0 < $f_end_0 >>> 0) {
      HEAP32[$work$s2] = $data + $f_begin_0 | 0;
      HEAP32[$work$s2 + 1] = $f_end_0 - $f_begin_0 | 0;
      HEAP32[$work$s2 + 2] = 0;
      HEAP32[$work$s2 + 3] = 0;
      var $39 = HEAP32[$rndr + 48 >> 2];
      var $41 = HEAP32[$rndr + 104 >> 2];
      var $42 = FUNCTION_TABLE[$39]($ob, $work, $41);
      var $_end_0 = ($42 | 0) == 0 ? 0 : $end_0_lcssa15;
      var $_0 = $_end_0;
    } else {
      var $46 = HEAP32[$rndr + 48 >> 2];
      var $48 = HEAP32[$rndr + 104 >> 2];
      var $49 = FUNCTION_TABLE[$46]($ob, 0, $48);
      var $_end_05 = ($49 | 0) == 0 ? 0 : $end_0_lcssa15;
      STACKTOP = __stackBase__;
      return $_end_05;
    }
  }
  var $_0;
  STACKTOP = __stackBase__;
  return $_0;
  return null;
}

_char_codespan["X"] = 1;

function _char_linebreak($ob, $rndr, $data, $offset, $size) {
  var $1 = $offset >>> 0 < 2;
  do {
    if ($1) {
      var $_0 = 0;
    } else {
      if (HEAP8[$data - 1 | 0] << 24 >> 24 != 32) {
        var $_0 = 0;
        break;
      }
      if (HEAP8[$data - 2 | 0] << 24 >> 24 != 32) {
        var $_0 = 0;
        break;
      }
      var $10 = $ob + 4 | 0;
      var $11 = $ob | 0;
      var $13 = HEAP32[$10 >> 2];
      while (1) {
        var $13;
        if (($13 | 0) == 0) {
          break;
        }
        var $16 = $13 - 1 | 0;
        if (HEAP8[HEAP32[$11 >> 2] + $16 | 0] << 24 >> 24 != 32) {
          break;
        }
        HEAP32[$10 >> 2] = $16;
        var $13 = $16;
      }
      var $23 = HEAP32[$rndr + 64 >> 2];
      var $25 = HEAP32[$rndr + 104 >> 2];
      var $26 = FUNCTION_TABLE[$23]($ob, $25);
      var $_0 = ($26 | 0) != 0 & 1;
    }
  } while (0);
  var $_0;
  return $_0;
  return null;
}

function _char_link($ob, $rndr, $data, $offset, $size) {
  var $rndr$s2 = $rndr >> 2;
  var __label__;
  var $1 = ($offset | 0) == 0;
  do {
    if ($1) {
      var $2 = $rndr + 412 | 0;
      var $15 = $2;
      var $14 = HEAP32[$2 >> 2];
      __label__ = 6;
      break;
    }
    var $8 = $rndr + 412 | 0;
    var $9 = HEAPU32[$8 >> 2];
    if (HEAP8[$data - 1 | 0] << 24 >> 24 != 33) {
      var $15 = $8;
      var $14 = $9;
      __label__ = 6;
      break;
    }
    if ((HEAP32[$rndr$s2 + 15] | 0) == 0) {
      var $ret_0 = 0;
      var $i_8 = 1;
      var $251 = $8;
      var $250 = $9;
      __label__ = 92;
      break;
    }
    var $_ph38 = 1;
    var $_ph37 = $8;
    var $_ph = $9;
    __label__ = 7;
    break;
  } while (0);
  do {
    if (__label__ == 6) {
      var $14;
      var $15;
      if ((HEAP32[$rndr$s2 + 17] | 0) == 0) {
        var $ret_0 = 0;
        var $i_8 = 1;
        var $251 = $15;
        var $250 = $14;
        __label__ = 92;
        break;
      }
      var $_ph38 = 0;
      var $_ph37 = $15;
      var $_ph = $14;
      __label__ = 7;
      break;
    }
  } while (0);
  $_$80 : do {
    if (__label__ == 7) {
      var $_ph;
      var $_ph37;
      var $_ph38;
      var $text_has_nl_0 = 0;
      var $level_0 = 1;
      var $indvars_iv58 = 1;
      $_$82 : while (1) {
        var $indvars_iv58;
        var $level_0;
        var $text_has_nl_0;
        if ($indvars_iv58 >>> 0 >= $size >>> 0) {
          var $ret_0 = 0;
          var $i_8 = $indvars_iv58;
          var $251 = $_ph37;
          var $250 = $_ph;
          break $_$80;
        }
        var $23 = HEAPU8[$data + $indvars_iv58 | 0];
        var $24 = $23 << 24 >> 24 == 10;
        do {
          if ($24) {
            var $text_has_nl_1 = 1;
            var $level_1 = $level_0;
          } else {
            var $26 = $indvars_iv58 - 1 | 0;
            if (HEAP8[$data + $26 | 0] << 24 >> 24 == 92) {
              var $text_has_nl_1 = $text_has_nl_0;
              var $level_1 = $level_0;
              break;
            }
            if ($23 << 24 >> 24 == 91) {
              var $text_has_nl_1 = $text_has_nl_0;
              var $level_1 = $level_0 + 1 | 0;
            } else if ($23 << 24 >> 24 == 93) {
              var $34 = $level_0 - 1 | 0;
              if (($34 | 0) < 1) {
                break $_$82;
              }
              var $text_has_nl_1 = $text_has_nl_0;
              var $level_1 = $34;
            } else {
              var $text_has_nl_1 = $text_has_nl_0;
              var $level_1 = $level_0;
              break;
            }
          }
        } while (0);
        var $level_1;
        var $text_has_nl_1;
        var $text_has_nl_0 = $text_has_nl_1;
        var $level_0 = $level_1;
        var $indvars_iv58 = $indvars_iv58 + 1 | 0;
      }
      var $38 = $indvars_iv58 + 1 | 0;
      var $i_1 = $38;
      while (1) {
        var $i_1;
        if ($i_1 >>> 0 >= $size >>> 0) {
          __label__ = 69;
          break;
        }
        var $43 = HEAPU8[$data + $i_1 | 0];
        var $44 = $43 & 255;
        var $45 = __isspace($44);
        var $47 = $i_1 + 1 | 0;
        if (($45 | 0) == 0) {
          __label__ = 18;
          break;
        }
        var $i_1 = $47;
      }
      do {
        if (__label__ == 18) {
          if ($43 << 24 >> 24 == 40) {
            var $i_2_in = $i_1;
            while (1) {
              var $i_2_in;
              var $i_2 = $i_2_in + 1 | 0;
              if ($i_2 >>> 0 >= $size >>> 0) {
                var $i_3 = $i_2;
                break;
              }
              var $53 = HEAPU8[$data + $i_2 | 0] & 255;
              var $54 = __isspace($53);
              if (($54 | 0) == 0) {
                var $i_3 = $i_2;
                break;
              }
              var $i_2_in = $i_2;
            }
            $_$102 : while (1) {
              var $i_3;
              if ($i_3 >>> 0 >= $size >>> 0) {
                var $ret_0 = 0;
                var $i_8 = $i_3;
                var $251 = $_ph37;
                var $250 = $_ph;
                break $_$80;
              }
              var $59 = HEAPU8[$data + $i_3 | 0];
              if ($59 << 24 >> 24 == 92) {
                var $i_3 = $i_3 + 2 | 0;
              } else if ($59 << 24 >> 24 == 41) {
                var $i_5_ph = $i_3;
                var $link_e_0_ph = $i_3;
                var $title_b_0_ph = 0;
                var $title_e_1_ph = 0;
                __label__ = 46;
                break;
              } else {
                var $63 = ($i_3 | 0) == 0;
                do {
                  if (!$63) {
                    var $68 = HEAPU8[$data + ($i_3 - 1) | 0] & 255;
                    var $69 = __isspace($68);
                    if (($69 | 0) == 0) {
                      break;
                    }
                    if ($59 << 24 >> 24 == 39 || $59 << 24 >> 24 == 34) {
                      __label__ = 28;
                      break $_$102;
                    }
                  }
                } while (0);
                var $i_3 = $i_3 + 1 | 0;
              }
            }
            do {
              if (__label__ == 28) {
                var $75 = $i_3 + 1 | 0;
                var $in_title_0_ph = 0;
                var $i_4_ph = $75;
                $_$114 : while (1) {
                  var $i_4_ph;
                  var $in_title_0_ph;
                  $_$116 : do {
                    if ($in_title_0_ph) {
                      var $i_4_us = $i_4_ph;
                      while (1) {
                        var $i_4_us;
                        if ($i_4_us >>> 0 >= $size >>> 0) {
                          var $ret_0 = 0;
                          var $i_8 = $i_4_us;
                          var $251 = $_ph37;
                          var $250 = $_ph;
                          break $_$80;
                        }
                        var $81 = HEAPU8[$data + $i_4_us | 0];
                        if ($81 << 24 >> 24 == 92) {
                          var $i_4_us = $i_4_us + 2 | 0;
                        } else {
                          if ($81 << 24 >> 24 == $59 << 24 >> 24) {
                            var $i_4_lcssa17 = $i_4_us;
                            break $_$116;
                          }
                          if ($81 << 24 >> 24 == 41) {
                            var $title_e_0_in = $i_4_us;
                            break $_$114;
                          }
                          var $i_4_us = $i_4_us + 1 | 0;
                        }
                      }
                    } else {
                      var $i_4 = $i_4_ph;
                      while (1) {
                        var $i_4;
                        if ($i_4 >>> 0 >= $size >>> 0) {
                          var $ret_0 = 0;
                          var $i_8 = $i_4;
                          var $251 = $_ph37;
                          var $250 = $_ph;
                          break $_$80;
                        }
                        var $92 = HEAPU8[$data + $i_4 | 0];
                        if ($92 << 24 >> 24 == 92) {
                          var $i_4 = $i_4 + 2 | 0;
                        } else {
                          if ($92 << 24 >> 24 == $59 << 24 >> 24) {
                            var $i_4_lcssa17 = $i_4;
                            break $_$116;
                          }
                          var $i_4 = $i_4 + 1 | 0;
                        }
                      }
                    }
                  } while (0);
                  var $i_4_lcssa17;
                  var $in_title_0_ph = 1;
                  var $i_4_ph = $i_4_lcssa17 + 1 | 0;
                }
                while (1) {
                  var $title_e_0_in;
                  var $title_e_0 = $title_e_0_in - 1 | 0;
                  var $103 = HEAPU8[$data + $title_e_0 | 0];
                  if ($title_e_0 >>> 0 <= $75 >>> 0) {
                    break;
                  }
                  var $105 = $103 & 255;
                  var $106 = __isspace($105);
                  if (($106 | 0) == 0) {
                    break;
                  }
                  var $title_e_0_in = $title_e_0;
                }
                if ($103 << 24 >> 24 == 39 || $103 << 24 >> 24 == 34) {
                  var $i_5_ph = $i_4_us;
                  var $link_e_0_ph = $i_3;
                  var $title_b_0_ph = $75;
                  var $title_e_1_ph = $title_e_0;
                  break;
                }
                var $i_5_ph = $i_4_us;
                var $link_e_0_ph = $i_4_us;
                var $title_b_0_ph = 0;
                var $title_e_1_ph = 0;
              }
            } while (0);
            var $title_e_1_ph;
            var $title_b_0_ph;
            var $link_e_0_ph;
            var $i_5_ph;
            var $link_e_0 = $link_e_0_ph;
            while (1) {
              var $link_e_0;
              var $111 = $link_e_0 - 1 | 0;
              var $113 = HEAPU8[$data + $111 | 0];
              if ($link_e_0 >>> 0 <= $i_2 >>> 0) {
                var $118 = $113;
                break;
              }
              var $115 = $113 & 255;
              var $116 = __isspace($115);
              if (($116 | 0) == 0) {
                var $118 = $113;
                break;
              }
              var $link_e_0 = $111;
            }
            var $118;
            var $_i_2 = HEAP8[$data + $i_2 | 0] << 24 >> 24 == 60 ? $i_2_in + 2 | 0 : $i_2;
            var $link_e_1 = $118 << 24 >> 24 == 62 ? $111 : $link_e_0;
            if ($link_e_1 >>> 0 > $_i_2 >>> 0) {
              var $126 = _rndr_newbuf($rndr, 1);
              var $127 = $data + $_i_2 | 0;
              var $128 = $link_e_1 - $_i_2 | 0;
              _bufput($126, $127, $128);
              var $link_0 = $126;
            } else {
              var $link_0 = 0;
            }
            var $link_0;
            if ($title_e_1_ph >>> 0 > $title_b_0_ph >>> 0) {
              var $132 = _rndr_newbuf($rndr, 1);
              var $133 = $data + $title_b_0_ph | 0;
              _bufput($132, $133, $title_e_1_ph - $title_b_0_ph | 0);
              var $title_0 = $132;
            } else {
              var $title_0 = 0;
            }
            var $title_0;
            var $i_7 = $i_5_ph + 1 | 0;
            var $link_1 = $link_0;
            var $title_1 = $title_0;
            __label__ = 80;
            break;
          } else if ($43 << 24 >> 24 == 91) {
            var $i_6 = $47;
            while (1) {
              var $i_6;
              if ($i_6 >>> 0 >= $size >>> 0) {
                var $ret_0 = 0;
                var $i_8 = $i_6;
                var $251 = $_ph37;
                var $250 = $_ph;
                break $_$80;
              }
              var $142 = $i_6 + 1 | 0;
              if (HEAP8[$data + $i_6 | 0] << 24 >> 24 == 93) {
                break;
              }
              var $i_6 = $142;
            }
            if (($47 | 0) == ($i_6 | 0)) {
              if (($text_has_nl_0 | 0) == 0) {
                var $id_0_0 = $data + 1 | 0;
                var $id_1_0 = $26;
              } else {
                var $148 = _rndr_newbuf($rndr, 1);
                var $149 = $indvars_iv58 >>> 0 > 1;
                $_$157 : do {
                  if ($149) {
                    var $j_014 = 1;
                    while (1) {
                      var $j_014;
                      var $151 = HEAPU8[$data + $j_014 | 0];
                      var $152 = $151 << 24 >> 24 == 10;
                      do {
                        if ($152) {
                          if (HEAP8[$data + ($j_014 - 1) | 0] << 24 >> 24 == 32) {
                            break;
                          }
                          _bufputc($148, 32);
                        } else {
                          var $154 = $151 & 255;
                          _bufputc($148, $154);
                        }
                      } while (0);
                      var $162 = $j_014 + 1 | 0;
                      if (($162 | 0) == ($indvars_iv58 | 0)) {
                        break $_$157;
                      }
                      var $j_014 = $162;
                    }
                  }
                } while (0);
                var $id_0_0 = HEAP32[$148 >> 2];
                var $id_1_0 = HEAP32[$148 + 4 >> 2];
              }
            } else {
              var $id_0_0 = $data + $47 | 0;
              var $id_1_0 = $i_6 - $47 | 0;
            }
            var $id_1_0;
            var $id_0_0;
            var $173 = $rndr + 108 | 0;
            var $174 = _find_link_ref($173, $id_0_0, $id_1_0);
            if (($174 | 0) == 0) {
              var $ret_0 = 0;
              var $i_8 = $i_6;
              var $251 = $_ph37;
              var $250 = $_ph;
              break $_$80;
            }
            var $i_7 = $142;
            var $link_1 = HEAP32[$174 + 4 >> 2];
            var $title_1 = HEAP32[$174 + 8 >> 2];
            __label__ = 80;
            break;
          } else {
            __label__ = 69;
            break;
          }
        }
      } while (0);
      if (__label__ == 69) {
        if (($text_has_nl_0 | 0) == 0) {
          var $id1_1_0 = $26;
          var $id1_0_0 = $data + 1 | 0;
        } else {
          var $183 = _rndr_newbuf($rndr, 1);
          var $184 = $indvars_iv58 >>> 0 > 1;
          $_$174 : do {
            if ($184) {
              var $j4_030 = 1;
              while (1) {
                var $j4_030;
                var $186 = HEAPU8[$data + $j4_030 | 0];
                var $187 = $186 << 24 >> 24 == 10;
                do {
                  if ($187) {
                    if (HEAP8[$data + ($j4_030 - 1) | 0] << 24 >> 24 == 32) {
                      break;
                    }
                    _bufputc($183, 32);
                  } else {
                    var $189 = $186 & 255;
                    _bufputc($183, $189);
                  }
                } while (0);
                var $197 = $j4_030 + 1 | 0;
                if (($197 | 0) == ($indvars_iv58 | 0)) {
                  break $_$174;
                }
                var $j4_030 = $197;
              }
            }
          } while (0);
          var $id1_1_0 = HEAP32[$183 + 4 >> 2];
          var $id1_0_0 = HEAP32[$183 >> 2];
        }
        var $id1_0_0;
        var $id1_1_0;
        var $205 = $rndr + 108 | 0;
        var $206 = _find_link_ref($205, $id1_0_0, $id1_1_0);
        if (($206 | 0) == 0) {
          var $ret_0 = 0;
          var $i_8 = $i_1;
          var $251 = $_ph37;
          var $250 = $_ph;
          break;
        }
        var $i_7 = $38;
        var $link_1 = HEAP32[$206 + 4 >> 2];
        var $title_1 = HEAP32[$206 + 8 >> 2];
      }
      var $title_1;
      var $link_1;
      var $i_7;
      if ($indvars_iv58 >>> 0 > 1) {
        var $216 = _rndr_newbuf($rndr, 1);
        if ($_ph38) {
          var $218 = $data + 1 | 0;
          _bufput($216, $218, $26);
          var $content_0 = $216;
        } else {
          var $220 = $rndr + 428 | 0;
          HEAP32[$220 >> 2] = 1;
          var $221 = $data + 1 | 0;
          _parse_inline($216, $rndr, $221, $26);
          HEAP32[$220 >> 2] = 0;
          var $content_0 = $216;
        }
      } else {
        var $content_0 = 0;
      }
      var $content_0;
      if (($link_1 | 0) == 0) {
        var $u_link_0 = 0;
      } else {
        var $225 = _rndr_newbuf($rndr, 1);
        _unscape_text($225, $link_1);
        var $u_link_0 = $225;
      }
      var $u_link_0;
      if ($_ph38) {
        var $228 = $ob + 4 | 0;
        var $229 = HEAP32[$228 >> 2];
        var $230 = ($229 | 0) == 0;
        do {
          if (!$230) {
            var $232 = $229 - 1 | 0;
            if (HEAP8[HEAP32[$ob >> 2] + $232 | 0] << 24 >> 24 != 33) {
              break;
            }
            HEAP32[$228 >> 2] = $232;
          }
        } while (0);
        var $240 = HEAP32[$rndr$s2 + 15];
        var $242 = HEAP32[$rndr$s2 + 26];
        var $243 = FUNCTION_TABLE[$240]($ob, $u_link_0, $title_1, $content_0, $242);
        var $ret_0 = $243;
        var $i_8 = $i_7;
        var $251 = $_ph37;
        var $250 = $_ph;
      } else {
        var $246 = HEAP32[$rndr$s2 + 17];
        var $248 = HEAP32[$rndr$s2 + 26];
        var $249 = FUNCTION_TABLE[$246]($ob, $u_link_0, $title_1, $content_0, $248);
        var $ret_0 = $249;
        var $i_8 = $i_7;
        var $251 = $_ph37;
        var $250 = $_ph;
      }
    }
  } while (0);
  var $250;
  var $251;
  var $i_8;
  var $ret_0;
  HEAP32[$251 >> 2] = $250;
  var $253 = ($ret_0 | 0) != 0 ? $i_8 : 0;
  return $253;
  return null;
}

_char_link["X"] = 1;

function _char_langle_tag($ob, $rndr, $data, $offset, $size) {
  var __stackBase__ = STACKTOP;
  STACKTOP += 20;
  assert(STACKTOP % 4 == 0, "Stack is unaligned");
  assert(STACKTOP < STACK_MAX, "Ran out of stack");
  var $altype = __stackBase__;
  var $work = __stackBase__ + 4;
  HEAP32[$altype >> 2] = 0;
  var $1 = _tag_length($data, $size, $altype);
  var $2 = $work | 0;
  HEAP32[$2 >> 2] = $data;
  var $3 = $work + 4 | 0;
  HEAP32[$3 >> 2] = $1;
  HEAP32[$work + 8 >> 2] = 0;
  HEAP32[$work + 12 >> 2] = 0;
  var $6 = $1 >>> 0 > 2;
  $_$205 : do {
    if ($6) {
      var $8 = $rndr + 44 | 0;
      var $10 = (HEAP32[$8 >> 2] | 0) == 0;
      do {
        if (!$10) {
          var $12 = HEAPU32[$altype >> 2];
          if (($12 | 0) == 0) {
            break;
          }
          var $15 = _rndr_newbuf($rndr, 1);
          HEAP32[$2 >> 2] = $data + 1 | 0;
          HEAP32[$3 >> 2] = $1 - 2 | 0;
          _unscape_text($15, $work);
          var $18 = HEAP32[$8 >> 2];
          var $20 = HEAP32[$rndr + 104 >> 2];
          var $21 = FUNCTION_TABLE[$18]($ob, $15, $12, $20);
          _rndr_popbuf($rndr, 1);
          var $ret_0 = $21;
          break $_$205;
        }
      } while (0);
      var $24 = HEAP32[$rndr + 72 >> 2];
      if (($24 | 0) == 0) {
        var $ret_0 = 0;
        break;
      }
      var $28 = HEAP32[$rndr + 104 >> 2];
      var $29 = FUNCTION_TABLE[$24]($ob, $work, $28);
      var $ret_0 = $29;
    } else {
      var $ret_0 = 0;
    }
  } while (0);
  var $ret_0;
  var $_ = ($ret_0 | 0) == 0 ? 0 : $1;
  STACKTOP = __stackBase__;
  return $_;
  return null;
}

function _char_escape($ob, $rndr, $data, $offset, $size) {
  var $1$s2;
  var __stackBase__ = STACKTOP;
  STACKTOP += 16;
  assert(STACKTOP % 4 == 0, "Stack is unaligned");
  assert(STACKTOP < STACK_MAX, "Ran out of stack");
  var $work = __stackBase__;
  var $1$s2 = $work >> 2;
  HEAP32[$1$s2] = 0;
  HEAP32[$1$s2 + 1] = 0;
  HEAP32[$1$s2 + 2] = 0;
  HEAP32[$1$s2 + 3] = 0;
  var $2 = $size >>> 0 > 1;
  do {
    if ($2) {
      var $4 = $data + 1 | 0;
      var $6 = HEAPU8[$4] & 255;
      var $memchr = _memchr(STRING_TABLE.__str30 | 0, $6, 23);
      if (($memchr | 0) == 0) {
        var $_0 = 0;
        break;
      }
      var $10 = HEAPU32[$rndr + 92 >> 2];
      if (($10 | 0) == 0) {
        _bufputc($ob, $6);
        var $_0 = 2;
      } else {
        HEAP32[$work >> 2] = $4;
        HEAP32[$work + 4 >> 2] = 1;
        var $16 = HEAP32[$rndr + 104 >> 2];
        FUNCTION_TABLE[$10]($ob, $work, $16);
        var $_0 = 2;
      }
    } else {
      if (($size | 0) != 1) {
        var $_0 = 2;
        break;
      }
      var $22 = HEAPU8[$data] & 255;
      _bufputc($ob, $22);
      var $_0 = 2;
    }
  } while (0);
  var $_0;
  STACKTOP = __stackBase__;
  return $_0;
  return null;
}

function __isspace($c) {
  return (($c | 0) == 32 | ($c | 0) == 10) & 1;
  return null;
}

function _char_entity($ob, $rndr, $data, $offset, $size) {
  var $1$s2;
  var __stackBase__ = STACKTOP;
  STACKTOP += 16;
  assert(STACKTOP % 4 == 0, "Stack is unaligned");
  assert(STACKTOP < STACK_MAX, "Ran out of stack");
  var __label__;
  var $work = __stackBase__;
  var $1$s2 = $work >> 2;
  HEAP32[$1$s2] = 0;
  HEAP32[$1$s2 + 1] = 0;
  HEAP32[$1$s2 + 2] = 0;
  HEAP32[$1$s2 + 3] = 0;
  if ($size >>> 0 > 1) {
    var $_ = HEAP8[$data + 1 | 0] << 24 >> 24 == 35 ? 2 : 1;
    var $end_0 = $_;
  } else {
    var $end_0 = 1;
    __label__ = 4;
  }
  while (1) {
    var $end_0;
    if ($end_0 >>> 0 >= $size >>> 0) {
      var $_0 = 0;
      break;
    }
    var $9 = $data + $end_0 | 0;
    var $11 = HEAPU8[$9] & 255;
    var $12 = _isalnum($11);
    var $14 = $end_0 + 1 | 0;
    if (($12 | 0) != 0) {
      var $end_0 = $14;
      continue;
    }
    if (HEAP8[$9] << 24 >> 24 != 59) {
      var $_0 = 0;
      break;
    }
    var $20 = HEAPU32[$rndr + 88 >> 2];
    if (($20 | 0) == 0) {
      _bufput($ob, $data, $14);
      var $_0 = $14;
      break;
    }
    HEAP32[$work >> 2] = $data;
    HEAP32[$work + 4 >> 2] = $14;
    var $26 = HEAP32[$rndr + 104 >> 2];
    FUNCTION_TABLE[$20]($ob, $work, $26);
    var $_0 = $14;
    break;
  }
  var $_0;
  STACKTOP = __stackBase__;
  return $_0;
  return null;
}

function _char_autolink_url($ob, $rndr, $data, $offset, $size) {
  var __stackBase__ = STACKTOP;
  STACKTOP += 4;
  assert(STACKTOP % 4 == 0, "Stack is unaligned");
  assert(STACKTOP < STACK_MAX, "Ran out of stack");
  var $rewind = __stackBase__;
  var $1 = $rndr + 44 | 0;
  var $3 = (HEAP32[$1 >> 2] | 0) == 0;
  do {
    if ($3) {
      var $_0 = 0;
    } else {
      if ((HEAP32[$rndr + 428 >> 2] | 0) != 0) {
        var $_0 = 0;
        break;
      }
      var $9 = _rndr_newbuf($rndr, 1);
      var $10 = _sd_autolink__url($rewind, $9, $data, $offset, $size);
      if (($10 | 0) != 0) {
        var $14 = $ob + 4 | 0;
        var $16 = HEAP32[$14 >> 2] - HEAP32[$rewind >> 2] | 0;
        HEAP32[$14 >> 2] = $16;
        var $17 = HEAP32[$1 >> 2];
        var $19 = HEAP32[$rndr + 104 >> 2];
        var $20 = FUNCTION_TABLE[$17]($ob, $9, 1, $19);
      }
      _rndr_popbuf($rndr, 1);
      var $_0 = $10;
    }
  } while (0);
  var $_0;
  STACKTOP = __stackBase__;
  return $_0;
  return null;
}

function _char_autolink_email($ob, $rndr, $data, $offset, $size) {
  var __stackBase__ = STACKTOP;
  STACKTOP += 4;
  assert(STACKTOP % 4 == 0, "Stack is unaligned");
  assert(STACKTOP < STACK_MAX, "Ran out of stack");
  var $rewind = __stackBase__;
  var $1 = $rndr + 44 | 0;
  var $3 = (HEAP32[$1 >> 2] | 0) == 0;
  do {
    if ($3) {
      var $_0 = 0;
    } else {
      if ((HEAP32[$rndr + 428 >> 2] | 0) != 0) {
        var $_0 = 0;
        break;
      }
      var $9 = _rndr_newbuf($rndr, 1);
      var $10 = _sd_autolink__email($rewind, $9, $data, $offset, $size);
      if (($10 | 0) != 0) {
        var $14 = $ob + 4 | 0;
        var $16 = HEAP32[$14 >> 2] - HEAP32[$rewind >> 2] | 0;
        HEAP32[$14 >> 2] = $16;
        var $17 = HEAP32[$1 >> 2];
        var $19 = HEAP32[$rndr + 104 >> 2];
        var $20 = FUNCTION_TABLE[$17]($ob, $9, 2, $19);
      }
      _rndr_popbuf($rndr, 1);
      var $_0 = $10;
    }
  } while (0);
  var $_0;
  STACKTOP = __stackBase__;
  return $_0;
  return null;
}

function _char_autolink_www($ob, $rndr, $data, $offset, $size) {
  var $1$s2;
  var __stackBase__ = STACKTOP;
  STACKTOP += 4;
  assert(STACKTOP % 4 == 0, "Stack is unaligned");
  assert(STACKTOP < STACK_MAX, "Ran out of stack");
  var $rewind = __stackBase__;
  var $1$s2 = ($rndr + 68 | 0) >> 2;
  var $3 = (HEAP32[$1$s2] | 0) == 0;
  do {
    if ($3) {
      var $_0 = 0;
    } else {
      if ((HEAP32[$rndr + 428 >> 2] | 0) != 0) {
        var $_0 = 0;
        break;
      }
      var $9 = _rndr_newbuf($rndr, 1);
      var $10 = _sd_autolink__www($rewind, $9, $data, $offset, $size);
      if (($10 | 0) != 0) {
        var $13 = _rndr_newbuf($rndr, 1);
        _bufput($13, STRING_TABLE.__str146 | 0, 7);
        var $15 = HEAP32[$9 >> 2];
        var $17 = HEAP32[$9 + 4 >> 2];
        _bufput($13, $15, $17);
        var $19 = $ob + 4 | 0;
        var $21 = HEAP32[$19 >> 2] - HEAP32[$rewind >> 2] | 0;
        HEAP32[$19 >> 2] = $21;
        var $22 = $rndr + 92 | 0;
        if ((HEAP32[$22 >> 2] | 0) == 0) {
          var $34 = HEAP32[$1$s2];
          var $36 = HEAP32[$rndr + 104 >> 2];
          var $37 = FUNCTION_TABLE[$34]($ob, $13, 0, $9, $36);
        } else {
          var $26 = _rndr_newbuf($rndr, 1);
          var $27 = HEAP32[$22 >> 2];
          var $28 = $rndr + 104 | 0;
          var $29 = HEAP32[$28 >> 2];
          FUNCTION_TABLE[$27]($26, $9, $29);
          var $30 = HEAP32[$1$s2];
          var $31 = HEAP32[$28 >> 2];
          var $32 = FUNCTION_TABLE[$30]($ob, $13, 0, $26, $31);
          _rndr_popbuf($rndr, 1);
        }
        _rndr_popbuf($rndr, 1);
      }
      _rndr_popbuf($rndr, 1);
      var $_0 = $10;
    }
  } while (0);
  var $_0;
  STACKTOP = __stackBase__;
  return $_0;
  return null;
}

_char_autolink_www["X"] = 1;

function _char_superscript($ob, $rndr, $data, $offset, $size) {
  var $1 = $rndr + 84 | 0;
  var $or_cond = (HEAP32[$1 >> 2] | 0) == 0 | $size >>> 0 < 2;
  $_$42 : do {
    if ($or_cond) {
      var $_0 = 0;
    } else {
      var $8 = HEAP8[$data + 1 | 0] << 24 >> 24 == 40;
      $_$44 : do {
        if ($8) {
          var $sup_len_0 = 2;
          while (1) {
            var $sup_len_0;
            if ($sup_len_0 >>> 0 >= $size >>> 0) {
              break;
            }
            if (HEAP8[$data + $sup_len_0 | 0] << 24 >> 24 == 41) {
              break;
            }
            if (HEAP8[$data + ($sup_len_0 - 1) | 0] << 24 >> 24 == 92) {
              break;
            }
            var $sup_len_0 = $sup_len_0 + 1 | 0;
          }
          if (($sup_len_0 | 0) == ($size | 0)) {
            var $_0 = 0;
            break $_$42;
          }
          var $sup_len_2 = $sup_len_0;
          var $sup_start_0 = 2;
        } else {
          var $sup_len_1 = 1;
          while (1) {
            var $sup_len_1;
            if ($sup_len_1 >>> 0 >= $size >>> 0) {
              var $sup_len_2 = $sup_len_1;
              var $sup_start_0 = 1;
              break $_$44;
            }
            var $25 = HEAPU8[$data + $sup_len_1 | 0] & 255;
            var $26 = __isspace($25);
            if (($26 | 0) != 0) {
              var $sup_len_2 = $sup_len_1;
              var $sup_start_0 = 1;
              break $_$44;
            }
            var $sup_len_1 = $sup_len_1 + 1 | 0;
          }
        }
      } while (0);
      var $sup_start_0;
      var $sup_len_2;
      if (($sup_len_2 | 0) == ($sup_start_0 | 0)) {
        var $32 = ($sup_start_0 | 0) == 2 ? 3 : 0;
        var $_0 = $32;
      } else {
        var $34 = $sup_len_2 - $sup_start_0 | 0;
        var $35 = _rndr_newbuf($rndr, 1);
        var $36 = $data + $sup_start_0 | 0;
        _parse_inline($35, $rndr, $36, $34);
        var $37 = HEAP32[$1 >> 2];
        var $39 = HEAP32[$rndr + 104 >> 2];
        var $40 = FUNCTION_TABLE[$37]($ob, $35, $39);
        _rndr_popbuf($rndr, 1);
        var $_0 = (($sup_start_0 | 0) == 2 & 1) + $sup_len_2 | 0;
      }
    }
  } while (0);
  var $_0;
  return $_0;
  return null;
}

_char_superscript["X"] = 1;

function _tag_length($data, $size, $autolink) {
  var $autolink$s2 = $autolink >> 2;
  var $1 = $size >>> 0 < 3;
  $_$60 : do {
    if ($1) {
      var $_lcssa = 0;
    } else {
      if (HEAP8[$data] << 24 >> 24 != 60) {
        var $_lcssa = 0;
        break;
      }
      var $9 = HEAP8[$data + 1 | 0] << 24 >> 24 == 47 ? 2 : 1;
      var $12 = HEAPU8[$data + $9 | 0] & 255;
      var $13 = _isalnum($12);
      if (($13 | 0) == 0) {
        var $_lcssa = 0;
        break;
      }
      HEAP32[$autolink$s2] = 0;
      var $i_0 = $9;
      while (1) {
        var $i_0;
        if ($i_0 >>> 0 >= $size >>> 0) {
          break;
        }
        var $19 = $data + $i_0 | 0;
        var $21 = HEAPU8[$19] & 255;
        var $22 = _isalnum($21);
        if (($22 | 0) == 0) {
          var $25 = HEAP8[$19];
          if (!($25 << 24 >> 24 == 46 || $25 << 24 >> 24 == 43 || $25 << 24 >> 24 == 45)) {
            break;
          }
        }
        var $i_0 = $i_0 + 1 | 0;
      }
      var $27 = $i_0 >>> 0 > 1;
      do {
        if ($27) {
          var $29 = $data + $i_0 | 0;
          var $31 = HEAP8[$29] << 24 >> 24 == 64;
          do {
            if ($31) {
              var $33 = $size - $i_0 | 0;
              var $34 = _is_mail_autolink($29, $33);
              if (($34 | 0) == 0) {
                break;
              }
              HEAP32[$autolink$s2] = 2;
              var $_lcssa = $34 + $i_0 | 0;
              break $_$60;
            }
          } while (0);
          if ($i_0 >>> 0 <= 2) {
            var $i_1 = $i_0;
            break;
          }
          if (HEAP8[$29] << 24 >> 24 != 58) {
            var $i_1 = $i_0;
            break;
          }
          HEAP32[$autolink$s2] = 1;
          var $i_1 = $i_0 + 1 | 0;
        } else {
          var $i_1 = $i_0;
        }
      } while (0);
      var $i_1;
      var $45 = $i_1 >>> 0 < $size >>> 0;
      do {
        if ($45) {
          if ((HEAP32[$autolink$s2] | 0) == 0) {
            var $i_3 = $i_1;
            break;
          }
          var $i_2 = $i_1;
          while (1) {
            var $i_2;
            if ($i_2 >>> 0 >= $size >>> 0) {
              var $_lcssa = 0;
              break $_$60;
            }
            var $53 = HEAPU8[$data + $i_2 | 0];
            if ($53 << 24 >> 24 == 92) {
              var $i_2 = $i_2 + 2 | 0;
            } else if ($53 << 24 >> 24 == 62 || $53 << 24 >> 24 == 39 || $53 << 24 >> 24 == 34 || $53 << 24 >> 24 == 32 || $53 << 24 >> 24 == 10) {
              break;
            } else {
              var $i_2 = $i_2 + 1 | 0;
            }
          }
          if ($i_2 >>> 0 > $i_1 >>> 0 & $53 << 24 >> 24 == 62) {
            var $_lcssa = $i_2 + 1 | 0;
            break $_$60;
          }
          HEAP32[$autolink$s2] = 0;
          var $i_3 = $i_2;
        } else {
          HEAP32[$autolink$s2] = 0;
          var $i_3 = $i_1;
        }
      } while (0);
      while (1) {
        var $i_3;
        if ($i_3 >>> 0 >= $size >>> 0) {
          var $_lcssa = 0;
          break $_$60;
        }
        var $69 = $i_3 + 1 | 0;
        if (HEAP8[$data + $i_3 | 0] << 24 >> 24 == 62) {
          var $_lcssa = $69;
          break $_$60;
        }
        var $i_3 = $69;
      }
    }
  } while (0);
  var $_lcssa;
  return $_lcssa;
  return null;
}

_tag_length["X"] = 1;

function _unscape_text($ob, $src) {
  var $2$s2;
  var $1 = $src + 4 | 0;
  var $2$s2 = ($src | 0) >> 2;
  var $i_0 = 0;
  while (1) {
    var $i_0;
    var $4 = HEAPU32[$1 >> 2];
    if ($i_0 >>> 0 >= $4 >>> 0) {
      break;
    }
    var $i_1 = $i_0;
    while (1) {
      var $i_1;
      if ($i_1 >>> 0 >= $4 >>> 0) {
        break;
      }
      if (HEAP8[HEAP32[$2$s2] + $i_1 | 0] << 24 >> 24 == 92) {
        break;
      }
      var $i_1 = $i_1 + 1 | 0;
    }
    if ($i_1 >>> 0 > $i_0 >>> 0) {
      var $16 = HEAP32[$2$s2] + $i_0 | 0;
      _bufput($ob, $16, $i_1 - $i_0 | 0);
      var $19 = HEAP32[$1 >> 2];
    } else {
      var $19 = $4;
    }
    var $19;
    var $20 = $i_1 + 1 | 0;
    if ($20 >>> 0 >= $19 >>> 0) {
      break;
    }
    var $26 = HEAPU8[HEAP32[$2$s2] + $20 | 0] & 255;
    _bufputc($ob, $26);
    var $i_0 = $i_1 + 2 | 0;
  }
  return;
  return;
}

function _is_mail_autolink($data, $size) {
  var $nb_0 = 0;
  var $i_0 = 0;
  $_$110 : while (1) {
    var $i_0;
    var $nb_0;
    if ($i_0 >>> 0 >= $size >>> 0) {
      var $_0 = 0;
      break;
    }
    var $4 = $data + $i_0 | 0;
    var $6 = HEAPU8[$4] & 255;
    var $7 = _isalnum($6);
    var $8 = ($7 | 0) == 0;
    do {
      if ($8) {
        var $11 = HEAPU8[$4] & 255;
        if (($11 | 0) == 64) {
          var $nb_1 = $nb_0 + 1 | 0;
        } else if (($11 | 0) == 45 || ($11 | 0) == 46 || ($11 | 0) == 95) {
          var $nb_1 = $nb_0;
          break;
        } else if (($11 | 0) == 62) {
          var $_ = ($nb_0 | 0) == 1 ? $i_0 + 1 | 0 : 0;
          var $_0 = $_;
          break $_$110;
        } else {
          var $_0 = 0;
          break $_$110;
        }
      } else {
        var $nb_1 = $nb_0;
      }
    } while (0);
    var $nb_1;
    var $nb_0 = $nb_1;
    var $i_0 = $i_0 + 1 | 0;
  }
  var $_0;
  return $_0;
  return null;
}

function _find_link_ref($references, $name, $length) {
  var $1 = _hash_link_ref($name, $length);
  var $ref_0_in = (($1 & 7) << 2) + $references | 0;
  while (1) {
    var $ref_0_in;
    var $ref_0 = HEAP32[$ref_0_in >> 2];
    if (($ref_0 | 0) == 0) {
      var $_0 = 0;
      break;
    }
    if ((HEAP32[$ref_0 >> 2] | 0) == ($1 | 0)) {
      var $_0 = $ref_0;
      break;
    }
    var $ref_0_in = $ref_0 + 12 | 0;
  }
  var $_0;
  return $_0;
  return null;
}

function _hash_link_ref($link_ref, $length) {
  var $1 = ($length | 0) == 0;
  $_$126 : do {
    if ($1) {
      var $hash_0_lcssa = 0;
    } else {
      var $i_02 = 0;
      var $hash_03 = 0;
      while (1) {
        var $hash_03;
        var $i_02;
        var $4 = HEAPU8[$link_ref + $i_02 | 0] & 255;
        var $5 = _tolower($4);
        var $7 = $5 - $hash_03 + $hash_03 * 65600 | 0;
        var $8 = $i_02 + 1 | 0;
        if (($8 | 0) == ($length | 0)) {
          var $hash_0_lcssa = $7;
          break $_$126;
        }
        var $i_02 = $8;
        var $hash_03 = $7;
      }
    }
  } while (0);
  var $hash_0_lcssa;
  return $hash_0_lcssa;
  return null;
}

function _parse_emph1($ob, $rndr, $data, $size, $c) {
  var $1 = $rndr + 56 | 0;
  var $3 = (HEAP32[$1 >> 2] | 0) == 0;
  $_$131 : do {
    if ($3) {
      var $_0 = 0;
    } else {
      var $5 = $size >>> 0 > 1;
      do {
        if ($5) {
          if (HEAP8[$data] << 24 >> 24 != $c << 24 >> 24) {
            var $i_0_ph = 0;
            break;
          }
          var $i_0_ph = HEAP8[$data + 1 | 0] << 24 >> 24 == $c << 24 >> 24 & 1;
        } else {
          var $i_0_ph = 0;
        }
      } while (0);
      var $i_0_ph;
      var $13 = $rndr + 420 | 0;
      var $i_0 = $i_0_ph;
      while (1) {
        var $i_0;
        if ($i_0 >>> 0 >= $size >>> 0) {
          var $_0 = 0;
          break $_$131;
        }
        var $16 = $data + $i_0 | 0;
        var $17 = $size - $i_0 | 0;
        var $18 = _find_emph_char($16, $17, $c);
        if (($18 | 0) == 0) {
          var $_0 = 0;
          break $_$131;
        }
        var $21 = $18 + $i_0 | 0;
        if ($21 >>> 0 >= $size >>> 0) {
          var $_0 = 0;
          break $_$131;
        }
        if (HEAP8[$data + $21 | 0] << 24 >> 24 != $c << 24 >> 24) {
          var $i_0 = $21;
          continue;
        }
        var $31 = HEAPU8[$data + ($21 - 1) | 0] & 255;
        var $32 = __isspace($31);
        if (($32 | 0) != 0) {
          var $i_0 = $21;
          continue;
        }
        var $_pre = $21 + 1 | 0;
        if ((HEAP32[$13 >> 2] & 1 | 0) == 0 | ($_pre | 0) == ($size | 0)) {
          break;
        }
        var $42 = HEAPU8[$data + $_pre | 0] & 255;
        var $43 = __isspace($42);
        if (($43 | 0) != 0) {
          break;
        }
        var $46 = _ispunct($42);
        if (($46 | 0) != 0) {
          break;
        }
        var $i_0 = $21;
      }
      var $48 = _rndr_newbuf($rndr, 1);
      _parse_inline($48, $rndr, $data, $21);
      var $49 = HEAP32[$1 >> 2];
      var $51 = HEAP32[$rndr + 104 >> 2];
      var $52 = FUNCTION_TABLE[$49]($ob, $48, $51);
      _rndr_popbuf($rndr, 1);
      var $_1 = ($52 | 0) == 0 ? 0 : $_pre;
      var $_0 = $_1;
    }
  } while (0);
  var $_0;
  return $_0;
  return null;
}

_parse_emph1["X"] = 1;

function _parse_emph2($ob, $rndr, $data, $size, $c) {
  var $_in = $c << 24 >> 24 == 126 ? $rndr + 80 | 0 : $rndr + 52 | 0;
  var $4 = HEAPU32[$_in >> 2];
  var $5 = ($4 | 0) == 0;
  $_$149 : do {
    if ($5) {
      var $_0 = 0;
    } else {
      var $i_0 = 0;
      while (1) {
        var $i_0;
        if ($i_0 >>> 0 >= $size >>> 0) {
          var $_0 = 0;
          break $_$149;
        }
        var $8 = $data + $i_0 | 0;
        var $9 = $size - $i_0 | 0;
        var $10 = _find_emph_char($8, $9, $c);
        if (($10 | 0) == 0) {
          var $_0 = 0;
          break $_$149;
        }
        var $13 = $10 + $i_0 | 0;
        var $14 = $13 + 1 | 0;
        if ($14 >>> 0 >= $size >>> 0) {
          var $i_0 = $14;
          continue;
        }
        if (HEAP8[$data + $13 | 0] << 24 >> 24 != $c << 24 >> 24) {
          var $i_0 = $14;
          continue;
        }
        if (HEAP8[$data + $14 | 0] << 24 >> 24 != $c << 24 >> 24 | ($13 | 0) == 0) {
          var $i_0 = $14;
          continue;
        }
        var $29 = HEAPU8[$data + ($13 - 1) | 0] & 255;
        var $30 = __isspace($29);
        if (($30 | 0) == 0) {
          break;
        }
        var $i_0 = $14;
      }
      var $33 = _rndr_newbuf($rndr, 1);
      _parse_inline($33, $rndr, $data, $13);
      var $35 = HEAP32[$rndr + 104 >> 2];
      var $36 = FUNCTION_TABLE[$4]($ob, $33, $35);
      _rndr_popbuf($rndr, 1);
      var $_ = ($36 | 0) == 0 ? 0 : $13 + 2 | 0;
      var $_0 = $_;
    }
  } while (0);
  var $_0;
  return $_0;
  return null;
}

function _parse_emph3($ob, $rndr, $data, $size, $c) {
  var $i_0 = 0;
  $_$160 : while (1) {
    var $i_0;
    if ($i_0 >>> 0 >= $size >>> 0) {
      var $_0 = 0;
      break;
    }
    var $3 = $data + $i_0 | 0;
    var $4 = $size - $i_0 | 0;
    var $5 = _find_emph_char($3, $4, $c);
    if (($5 | 0) == 0) {
      var $_0 = 0;
      break;
    }
    var $8 = $5 + $i_0 | 0;
    if (HEAP8[$data + $8 | 0] << 24 >> 24 != $c << 24 >> 24) {
      var $i_0 = $8;
      continue;
    }
    var $16 = HEAPU8[$data + ($8 - 1) | 0] & 255;
    var $17 = __isspace($16);
    if (($17 | 0) != 0) {
      var $i_0 = $8;
      continue;
    }
    var $20 = $8 + 2 | 0;
    var $21 = $20 >>> 0 < $size >>> 0;
    var $22 = $8 + 1 | 0;
    do {
      if ($21) {
        if (HEAP8[$data + $22 | 0] << 24 >> 24 != $c << 24 >> 24) {
          break;
        }
        if (HEAP8[$data + $20 | 0] << 24 >> 24 != $c << 24 >> 24) {
          break;
        }
        var $32 = $rndr + 76 | 0;
        if ((HEAP32[$32 >> 2] | 0) == 0) {
          break;
        }
        var $36 = _rndr_newbuf($rndr, 1);
        _parse_inline($36, $rndr, $data, $8);
        var $37 = HEAP32[$32 >> 2];
        var $39 = HEAP32[$rndr + 104 >> 2];
        var $40 = FUNCTION_TABLE[$37]($ob, $36, $39);
        _rndr_popbuf($rndr, 1);
        var $_ = ($40 | 0) == 0 ? 0 : $8 + 3 | 0;
        var $_0 = $_;
        break $_$160;
      }
    } while (0);
    var $43 = $22 >>> 0 < $size >>> 0;
    do {
      if ($43) {
        if (HEAP8[$data + $22 | 0] << 24 >> 24 != $c << 24 >> 24) {
          break;
        }
        var $49 = $data - 2 | 0;
        var $50 = $size + 2 | 0;
        var $51 = _parse_emph1($ob, $rndr, $49, $50, $c);
        var $_1 = ($51 | 0) == 0 ? 0 : $51 - 2 | 0;
        return $_1;
      }
    } while (0);
    var $55 = $data - 1 | 0;
    var $56 = $size + 1 | 0;
    var $57 = _parse_emph2($ob, $rndr, $55, $56, $c);
    var $_2 = ($57 | 0) == 0 ? 0 : $57 - 1 | 0;
    var $_0 = $_2;
    break;
  }
  var $_0;
  return $_0;
  return null;
}

_parse_emph3["X"] = 1;

function _find_emph_char($data, $size, $c) {
  var __label__;
  var $i_0 = 1;
  $_$2 : while (1) {
    var $i_0;
    if ($i_0 >>> 0 >= $size >>> 0) {
      var $_0 = 0;
      break;
    }
    var $i_1 = $i_0;
    while (1) {
      var $i_1;
      if ($i_1 >>> 0 >= $size >>> 0) {
        break;
      }
      var $5 = HEAPU8[$data + $i_1 | 0];
      if ($5 << 24 >> 24 == $c << 24 >> 24) {
        break;
      }
      if ($5 << 24 >> 24 == 96 || $5 << 24 >> 24 == 91) {
        break;
      }
      var $i_1 = $i_1 + 1 | 0;
    }
    if (($i_1 | 0) == ($size | 0)) {
      var $_0 = 0;
      break;
    }
    var $11 = HEAPU8[$data + $i_1 | 0];
    if ($11 << 24 >> 24 == $c << 24 >> 24) {
      var $_0 = $i_1;
      break;
    }
    var $14 = ($i_1 | 0) == 0;
    do {
      if (!$14) {
        if (HEAP8[$data + ($i_1 - 1) | 0] << 24 >> 24 != 92) {
          break;
        }
        var $i_0 = $i_1 + 1 | 0;
        continue $_$2;
      }
      __label__ = 13;
    } while (0);
    if ($11 << 24 >> 24 == 96) {
      var $i_2 = $i_1;
      var $span_nb_0 = 0;
      while (1) {
        var $span_nb_0;
        var $i_2;
        if ($i_2 >>> 0 >= $size >>> 0) {
          var $_0 = 0;
          break $_$2;
        }
        var $26 = HEAPU8[$data + $i_2 | 0];
        if ($26 << 24 >> 24 != 96) {
          break;
        }
        var $i_2 = $i_2 + 1 | 0;
        var $span_nb_0 = $span_nb_0 + 1 | 0;
      }
      if (($span_nb_0 | 0) == 0) {
        var $i_0 = $i_2;
        continue;
      }
      var $bt_017 = 1;
      var $i_318 = $i_2;
      var $tmp_i_019 = 0;
      var $32 = $26;
      while (1) {
        var $32;
        var $tmp_i_019;
        var $i_318;
        var $bt_017;
        if (($tmp_i_019 | 0) == 0) {
          var $i_3_tmp_i_0 = $32 << 24 >> 24 == $c << 24 >> 24 ? $i_318 : 0;
          var $tmp_i_1 = $i_3_tmp_i_0;
        } else {
          var $tmp_i_1 = $tmp_i_019;
        }
        var $tmp_i_1;
        var $bt_1 = $32 << 24 >> 24 == 96 ? $bt_017 : 0;
        var $37 = $i_318 + 1 | 0;
        var $38 = $37 >>> 0 < $size >>> 0;
        if (!($38 & $bt_1 >>> 0 < $span_nb_0 >>> 0)) {
          break;
        }
        var $_pre = HEAP8[$data + $37 | 0];
        var $bt_017 = $bt_1 + 1 | 0;
        var $i_318 = $37;
        var $tmp_i_019 = $tmp_i_1;
        var $32 = $_pre;
      }
      if (!$38) {
        var $_0 = $tmp_i_1;
        break;
      }
      var $i_0 = $37;
    } else if ($11 << 24 >> 24 == 91) {
      var $tmp_i1_0 = 0;
      var $i_4_in = $i_1;
      while (1) {
        var $i_4_in;
        var $tmp_i1_0;
        var $i_4 = $i_4_in + 1 | 0;
        if ($i_4 >>> 0 >= $size >>> 0) {
          break;
        }
        var $43 = HEAPU8[$data + $i_4 | 0];
        if ($43 << 24 >> 24 == 93) {
          break;
        }
        var $tmp_i1_1 = ($tmp_i1_0 | 0) == 0 & $43 << 24 >> 24 == $c << 24 >> 24 ? $i_4 : $tmp_i1_0;
        var $tmp_i1_0 = $tmp_i1_1;
        var $i_4_in = $i_4;
      }
      var $i_5 = $i_4_in + 2 | 0;
      while (1) {
        var $i_5;
        if ($i_5 >>> 0 >= $size >>> 0) {
          var $_0 = $tmp_i1_0;
          break $_$2;
        }
        var $53 = HEAPU8[$data + $i_5 | 0];
        if (!($53 << 24 >> 24 == 32 || $53 << 24 >> 24 == 10)) {
          break;
        }
        var $i_5 = $i_5 + 1 | 0;
      }
      var $57 = $53 & 255;
      if (($57 | 0) == 91) {
        var $cc_0 = 93;
      } else if (($57 | 0) == 40) {
        var $cc_0 = 41;
      } else {
        if (($tmp_i1_0 | 0) == 0) {
          var $i_0 = $i_5;
          continue;
        }
        var $_0 = $tmp_i1_0;
        break;
      }
      var $cc_0;
      var $tmp_i1_2 = $tmp_i1_0;
      var $i_6_in = $i_5;
      while (1) {
        var $i_6_in;
        var $tmp_i1_2;
        var $i_6 = $i_6_in + 1 | 0;
        if ($i_6 >>> 0 >= $size >>> 0) {
          var $_0 = $tmp_i1_2;
          break $_$2;
        }
        var $66 = HEAPU8[$data + $i_6 | 0];
        if (($66 & 255 | 0) == ($cc_0 | 0)) {
          break;
        }
        var $tmp_i1_3 = ($tmp_i1_2 | 0) == 0 & $66 << 24 >> 24 == $c << 24 >> 24 ? $i_6 : $tmp_i1_2;
        var $tmp_i1_2 = $tmp_i1_3;
        var $i_6_in = $i_6;
      }
      var $i_0 = $i_6_in + 2 | 0;
    } else {
      var $i_0 = $i_1;
      continue;
    }
  }
  var $_0;
  return $_0;
  return null;
}

_find_emph_char["X"] = 1;

function _prefix_codefence($data, $size) {
  var $1 = $size >>> 0 < 3;
  do {
    if ($1) {
      var $_0 = 0;
    } else {
      var $4 = HEAP8[$data] << 24 >> 24 == 32;
      do {
        if ($4) {
          if (HEAP8[$data + 1 | 0] << 24 >> 24 != 32) {
            var $i_0 = 1;
            break;
          }
          var $_ = HEAP8[$data + 2 | 0] << 24 >> 24 == 32 ? 3 : 2;
          var $i_0 = $_;
        } else {
          var $i_0 = 0;
        }
      } while (0);
      var $i_0;
      if (($i_0 + 2 | 0) >>> 0 >= $size >>> 0) {
        var $_0 = 0;
        break;
      }
      var $18 = HEAPU8[$data + $i_0 | 0];
      if (!($18 << 24 >> 24 == 126 || $18 << 24 >> 24 == 96)) {
        var $_0 = 0;
        break;
      }
      var $n_0 = 0;
      var $i_1 = $i_0;
      while (1) {
        var $i_1;
        var $n_0;
        if ($i_1 >>> 0 >= $size >>> 0) {
          break;
        }
        if (HEAP8[$data + $i_1 | 0] << 24 >> 24 != $18 << 24 >> 24) {
          break;
        }
        var $n_0 = $n_0 + 1 | 0;
        var $i_1 = $i_1 + 1 | 0;
      }
      var $_i_1 = $n_0 >>> 0 < 3 ? 0 : $i_1;
      var $_0 = $_i_1;
    }
  } while (0);
  var $_0;
  return $_0;
  return null;
}

function _is_next_headerline($data, $size) {
  var $i_0 = 0;
  while (1) {
    var $i_0;
    if ($i_0 >>> 0 >= $size >>> 0) {
      var $9 = $i_0 + 1 | 0;
      break;
    }
    var $8 = $i_0 + 1 | 0;
    if (HEAP8[$data + $i_0 | 0] << 24 >> 24 == 10) {
      var $9 = $8;
      break;
    }
    var $i_0 = $8;
  }
  var $9;
  if ($9 >>> 0 < $size >>> 0) {
    var $12 = $data + $9 | 0;
    var $13 = $size - $9 | 0;
    var $14 = _is_headerline($12, $13);
    var $_0 = $14;
  } else {
    var $_0 = 0;
  }
  var $_0;
  return $_0;
  return null;
}

function _parse_listitem($ob, $rndr, $data, $size, $flags) {
  var $111$s2;
  var $26$s2;
  var $flags$s2 = $flags >> 2;
  var __label__;
  var $orgpre_0 = 0;
  while (1) {
    var $orgpre_0;
    if (!($orgpre_0 >>> 0 < 3 & $orgpre_0 >>> 0 < $size >>> 0)) {
      break;
    }
    if (HEAP8[$data + $orgpre_0 | 0] << 24 >> 24 != 32) {
      break;
    }
    var $orgpre_0 = $orgpre_0 + 1 | 0;
  }
  var $9 = _prefix_uli($data, $size);
  var $10 = ($9 | 0) == 0;
  do {
    if ($10) {
      var $12 = _prefix_oli($data, $size);
      if (($12 | 0) == 0) {
        var $_0 = 0;
        __label__ = 51;
        break;
      }
      var $beg_014_ph = $12;
      __label__ = 7;
      break;
    } else {
      var $beg_014_ph = $9;
      __label__ = 7;
    }
  } while (0);
  if (__label__ == 7) {
    var $beg_014_ph;
    var $end_0 = $beg_014_ph;
    while (1) {
      var $end_0;
      if ($end_0 >>> 0 >= $size >>> 0) {
        break;
      }
      if (HEAP8[$data + ($end_0 - 1) | 0] << 24 >> 24 == 10) {
        break;
      }
      var $end_0 = $end_0 + 1 | 0;
    }
    var $21 = _rndr_newbuf($rndr, 1);
    var $22 = _rndr_newbuf($rndr, 1);
    var $23 = $data + $beg_014_ph | 0;
    _bufput($21, $23, $end_0 - $beg_014_ph | 0);
    var $25 = $rndr + 420 | 0;
    var $26$s2 = ($21 + 4 | 0) >> 2;
    var $in_fence_0_ph = 0;
    var $has_inside_empty_0_ph = 0;
    var $end_1_ph = $end_0;
    var $sublist_0_ph = 0;
    $_$86 : while (1) {
      var $sublist_0_ph;
      var $end_1_ph;
      var $has_inside_empty_0_ph;
      var $in_fence_0_ph;
      var $in_empty_0 = 0;
      var $end_1 = $end_1_ph;
      while (1) {
        var $end_1;
        var $in_empty_0;
        if ($end_1 >>> 0 >= $size >>> 0) {
          var $has_inside_empty_3 = $has_inside_empty_0_ph;
          break $_$86;
        }
        var $end_2_in = $end_1;
        while (1) {
          var $end_2_in;
          var $end_2 = $end_2_in + 1 | 0;
          if ($end_2 >>> 0 >= $size >>> 0) {
            break;
          }
          if (HEAP8[$data + $end_2_in | 0] << 24 >> 24 == 10) {
            break;
          }
          var $end_2_in = $end_2;
        }
        var $34 = $data + $end_1 | 0;
        var $35 = $end_2 - $end_1 | 0;
        var $36 = _is_empty($34, $35);
        if (($36 | 0) == 0) {
          var $i_0 = 0;
          break;
        }
        var $in_empty_0 = 1;
        var $end_1 = $end_2;
      }
      while (1) {
        var $i_0;
        if ($i_0 >>> 0 >= 4) {
          break;
        }
        var $40 = $i_0 + $end_1 | 0;
        if ($40 >>> 0 >= $end_2 >>> 0) {
          break;
        }
        if (HEAP8[$data + $40 | 0] << 24 >> 24 != 32) {
          break;
        }
        var $i_0 = $i_0 + 1 | 0;
      }
      var $49 = (HEAP32[$25 >> 2] & 4 | 0) == 0;
      do {
        if ($49) {
          var $in_fence_1 = $in_fence_0_ph;
        } else {
          var $51 = $data + $i_0 + $end_1 | 0;
          var $53 = _is_codefence($51, $35 - $i_0 | 0, 0);
          if (($53 | 0) == 0) {
            var $in_fence_1 = $in_fence_0_ph;
            break;
          }
          var $in_fence_1 = ($in_fence_0_ph | 0) == 0 & 1;
        }
      } while (0);
      var $in_fence_1;
      if (($in_fence_1 | 0) == 0) {
        var $61 = $data + $i_0 + $end_1 | 0;
        var $62 = $35 - $i_0 | 0;
        var $63 = _prefix_uli($61, $62);
        var $64 = _prefix_oli($61, $62);
        var $has_next_oli_0 = $64;
        var $has_next_uli_0 = $63;
      } else {
        var $has_next_oli_0 = 0;
        var $has_next_uli_0 = 0;
      }
      var $has_next_uli_0;
      var $has_next_oli_0;
      var $66 = ($in_empty_0 | 0) != 0;
      do {
        if ($66) {
          var $68 = HEAP32[$flags$s2];
          var $69 = $68 & 1;
          if (($69 | 0) == 0 | ($has_next_uli_0 | 0) == 0) {
            if (($69 | 0) != 0 | ($has_next_oli_0 | 0) == 0) {
              break;
            }
          }
          var $76 = $68 | 8;
          HEAP32[$flags$s2] = $76;
          var $has_inside_empty_3 = $has_inside_empty_0_ph;
          break $_$86;
        }
      } while (0);
      var $78 = ($has_next_uli_0 | 0) == 0;
      do {
        if ($78) {
          if (($has_next_oli_0 | 0) == 0) {
            __label__ = 34;
            break;
          }
          __label__ = 31;
          break;
        } else {
          var $80 = $data + $i_0 + $end_1 | 0;
          var $82 = _is_hrule($80, $35 - $i_0 | 0);
          if (($82 | 0) != 0 & ($has_next_oli_0 | 0) == 0) {
            __label__ = 34;
            break;
          }
          __label__ = 31;
          break;
        }
      } while (0);
      do {
        if (__label__ == 31) {
          var $_has_inside_empty_0 = $66 ? 1 : $has_inside_empty_0_ph;
          if (($i_0 | 0) == ($orgpre_0 | 0)) {
            var $has_inside_empty_3 = $_has_inside_empty_0;
            break $_$86;
          }
          if (($sublist_0_ph | 0) != 0) {
            var $has_inside_empty_2 = $_has_inside_empty_0;
            var $sublist_1 = $sublist_0_ph;
            break;
          }
          var $has_inside_empty_2 = $_has_inside_empty_0;
          var $sublist_1 = HEAP32[$26$s2];
        } else if (__label__ == 34) {
          if ($66 & ($i_0 | 0) == 0) {
            var $96 = HEAP32[$flags$s2] | 8;
            HEAP32[$flags$s2] = $96;
            var $has_inside_empty_3 = $has_inside_empty_0_ph;
            break $_$86;
          }
          if (!$66) {
            var $has_inside_empty_2 = $has_inside_empty_0_ph;
            var $sublist_1 = $sublist_0_ph;
            break;
          }
          _bufputc($21, 10);
          var $has_inside_empty_2 = 1;
          var $sublist_1 = $sublist_0_ph;
        }
      } while (0);
      var $sublist_1;
      var $has_inside_empty_2;
      var $100 = $data + $i_0 + $end_1 | 0;
      _bufput($21, $100, $35 - $i_0 | 0);
      var $in_fence_0_ph = $in_fence_1;
      var $has_inside_empty_0_ph = $has_inside_empty_2;
      var $end_1_ph = $end_2;
      var $sublist_0_ph = $sublist_1;
    }
    var $has_inside_empty_3;
    var $_pre = HEAP32[$flags$s2];
    if (($has_inside_empty_3 | 0) == 0) {
      var $105 = $_pre;
    } else {
      var $104 = $_pre | 2;
      HEAP32[$flags$s2] = $104;
      var $105 = $104;
    }
    var $105;
    var $109 = HEAPU32[$26$s2];
    var $or_cond53 = ($sublist_0_ph | 0) != 0 & $sublist_0_ph >>> 0 < $109 >>> 0;
    var $111$s2 = ($21 | 0) >> 2;
    var $112 = HEAP32[$111$s2];
    if (($105 & 2 | 0) == 0) {
      if ($or_cond53) {
        _parse_inline($22, $rndr, $112, $sublist_0_ph);
        var $122 = HEAP32[$111$s2] + $sublist_0_ph | 0;
        var $124 = HEAP32[$26$s2] - $sublist_0_ph | 0;
        _parse_block($22, $rndr, $122, $124);
      } else {
        _parse_inline($22, $rndr, $112, $109);
      }
    } else {
      if ($or_cond53) {
        _parse_block($22, $rndr, $112, $sublist_0_ph);
        var $116 = HEAP32[$111$s2] + $sublist_0_ph | 0;
        var $118 = HEAP32[$26$s2] - $sublist_0_ph | 0;
        _parse_block($22, $rndr, $116, $118);
      } else {
        _parse_block($22, $rndr, $112, $109);
      }
    }
    var $127 = HEAP32[$rndr + 24 >> 2];
    if (($127 | 0) != 0) {
      var $130 = HEAP32[$flags$s2];
      var $132 = HEAP32[$rndr + 104 >> 2];
      FUNCTION_TABLE[$127]($ob, $22, $130, $132);
    }
    _rndr_popbuf($rndr, 1);
    _rndr_popbuf($rndr, 1);
    var $_0 = $end_1;
  }
  var $_0;
  return $_0;
  return null;
}

_parse_listitem["X"] = 1;

function _parse_table_header($ob, $rndr, $data, $size, $columns, $column_data) {
  var __label__;
  var $i_0 = 0;
  var $pipes_0 = 0;
  while (1) {
    var $pipes_0;
    var $i_0;
    if ($i_0 >>> 0 >= $size >>> 0) {
      break;
    }
    var $5 = HEAPU8[$data + $i_0 | 0];
    if ($5 << 24 >> 24 == 10) {
      break;
    }
    var $_pipes_0 = ($5 << 24 >> 24 == 124 & 1) + $pipes_0 | 0;
    var $i_0 = $i_0 + 1 | 0;
    var $pipes_0 = $_pipes_0;
  }
  var $or_cond = ($i_0 | 0) == ($size | 0) | ($pipes_0 | 0) == 0;
  do {
    if ($or_cond) {
      var $_0 = 0;
    } else {
      var $header_end_0 = $i_0;
      while (1) {
        var $header_end_0;
        if (($header_end_0 | 0) == 0) {
          var $pipes_2 = ((HEAP8[$data] << 24 >> 24 == 124) << 31 >> 31) + $pipes_0 | 0;
          var $header_end_026 = 0;
          break;
        }
        var $18 = $header_end_0 - 1 | 0;
        var $20 = HEAPU8[$data + $18 | 0];
        var $21 = $20 & 255;
        var $22 = __isspace($21);
        if (($22 | 0) != 0) {
          var $header_end_0 = $18;
          continue;
        }
        var $pipes_2 = ((HEAP8[$data] << 24 >> 24 == 124) << 31 >> 31) + (($20 << 24 >> 24 == 124) << 31 >> 31) + $pipes_0 | 0;
        var $header_end_026 = $header_end_0;
        break;
      }
      var $header_end_026;
      var $pipes_2;
      var $31 = $pipes_2 + 1 | 0;
      HEAP32[$columns >> 2] = $31;
      var $32 = _calloc($31, 4);
      HEAP32[$column_data >> 2] = $32;
      var $34 = $i_0 + 1 | 0;
      if ($34 >>> 0 < $size >>> 0) {
        var $_ = HEAP8[$data + $34 | 0] << 24 >> 24 == 124 ? $i_0 + 2 | 0 : $34;
        var $i_1 = $_;
      } else {
        var $i_1 = $34;
      }
      var $i_1;
      var $under_end_0 = $i_1;
      while (1) {
        var $under_end_0;
        if ($under_end_0 >>> 0 >= $size >>> 0) {
          var $col_0 = 0;
          var $i_2 = $i_1;
          break;
        }
        if (HEAP8[$data + $under_end_0 | 0] << 24 >> 24 == 10) {
          var $col_0 = 0;
          var $i_2 = $i_1;
          break;
        }
        var $under_end_0 = $under_end_0 + 1 | 0;
      }
      $_$163 : while (1) {
        var $i_2;
        var $col_0;
        if (!($col_0 >>> 0 < HEAPU32[$columns >> 2] >>> 0 & $i_2 >>> 0 < $under_end_0 >>> 0)) {
          break;
        }
        var $i_3 = $i_2;
        while (1) {
          var $i_3;
          var $54 = HEAP8[$data + $i_3 | 0];
          if ($i_3 >>> 0 >= $under_end_0 >>> 0) {
            __label__ = 19;
            break;
          }
          if ($54 << 24 >> 24 == 32) {
            var $i_3 = $i_3 + 1 | 0;
          } else if ($54 << 24 >> 24 == 58) {
            __label__ = 20;
            break;
          } else {
            var $dashes_0 = 0;
            var $i_4 = $i_3;
            __label__ = 21;
            break;
          }
        }
        do {
          if (__label__ == 19) {
            if ($54 << 24 >> 24 == 58) {
              __label__ = 20;
              break;
            }
            var $dashes_0 = 0;
            var $i_4 = $i_3;
            __label__ = 21;
            break;
          }
        } while (0);
        if (__label__ == 20) {
          var $61 = ($col_0 << 2) + HEAP32[$column_data >> 2] | 0;
          var $63 = HEAP32[$61 >> 2] | 1;
          HEAP32[$61 >> 2] = $63;
          var $dashes_0 = 1;
          var $i_4 = $i_3 + 1 | 0;
        }
        while (1) {
          var $i_4;
          var $dashes_0;
          if ($i_4 >>> 0 >= $under_end_0 >>> 0) {
            var $dashes_1_ph = $dashes_0;
            var $i_5_ph = $i_4;
            break;
          }
          var $67 = HEAP8[$data + $i_4 | 0];
          if ($67 << 24 >> 24 == 45) {
            var $dashes_0 = $dashes_0 + 1 | 0;
            var $i_4 = $i_4 + 1 | 0;
          } else if ($67 << 24 >> 24 == 58) {
            var $74 = ($col_0 << 2) + HEAP32[$column_data >> 2] | 0;
            var $76 = HEAP32[$74 >> 2] | 2;
            HEAP32[$74 >> 2] = $76;
            var $dashes_1_ph = $dashes_0 + 1 | 0;
            var $i_5_ph = $i_4 + 1 | 0;
            break;
          } else {
            var $dashes_1_ph = $dashes_0;
            var $i_5_ph = $i_4;
            break;
          }
        }
        var $i_5_ph;
        var $dashes_1_ph;
        var $i_5 = $i_5_ph;
        while (1) {
          var $i_5;
          if ($i_5 >>> 0 >= $under_end_0 >>> 0) {
            if ($dashes_1_ph >>> 0 < 3) {
              break $_$163;
            }
            var $_pre_phi = $i_5 + 1 | 0;
            break;
          }
          var $81 = HEAPU8[$data + $i_5 | 0];
          var $83 = $i_5 + 1 | 0;
          if ($81 << 24 >> 24 == 32) {
            var $i_5 = $83;
            continue;
          }
          if ($81 << 24 >> 24 != 124 | $dashes_1_ph >>> 0 < 3) {
            break $_$163;
          }
          var $_pre_phi = $83;
          break;
        }
        var $_pre_phi;
        var $col_0 = $col_0 + 1 | 0;
        var $i_2 = $_pre_phi;
      }
      var $89 = HEAPU32[$columns >> 2];
      if ($col_0 >>> 0 < $89 >>> 0) {
        var $_0 = 0;
        break;
      }
      var $92 = HEAP32[$column_data >> 2];
      _parse_table_row($ob, $rndr, $data, $header_end_026, $89, $92, 4);
      var $_0 = $under_end_0 + 1 | 0;
    }
  } while (0);
  var $_0;
  return $_0;
  return null;
}

_parse_table_header["X"] = 1;

function _parse_table_row($ob, $rndr, $data, $size, $columns, $col_data, $header_flag) {
  var $18$s2;
  var $1$s2;
  var __stackBase__ = STACKTOP;
  STACKTOP += 16;
  assert(STACKTOP % 4 == 0, "Stack is unaligned");
  assert(STACKTOP < STACK_MAX, "Ran out of stack");
  var $empty_cell = __stackBase__;
  var $1$s2 = ($rndr + 40 | 0) >> 2;
  var $3 = (HEAP32[$1$s2] | 0) == 0;
  do {
    if (!$3) {
      var $5 = $rndr + 36 | 0;
      if ((HEAP32[$5 >> 2] | 0) == 0) {
        break;
      }
      var $9 = _rndr_newbuf($rndr, 1);
      if (($size | 0) == 0) {
        var $i_1_ph = 0;
      } else {
        var $i_1_ph = HEAP8[$data] << 24 >> 24 == 124 & 1;
      }
      var $i_1_ph;
      var $or_cond5 = ($columns | 0) != 0 & $i_1_ph >>> 0 < $size >>> 0;
      $_$197 : do {
        if ($or_cond5) {
          var $16 = $rndr + 104 | 0;
          var $i_16 = $i_1_ph;
          var $col_07 = 0;
          while (1) {
            var $col_07;
            var $i_16;
            var $21 = _rndr_newbuf($rndr, 1);
            var $i_2 = $i_16;
            while (1) {
              var $i_2;
              if ($i_2 >>> 0 >= $size >>> 0) {
                var $i_3 = $i_2;
                break;
              }
              var $27 = HEAPU8[$data + $i_2 | 0] & 255;
              var $28 = __isspace($27);
              if (($28 | 0) == 0) {
                var $i_3 = $i_2;
                break;
              }
              var $i_2 = $i_2 + 1 | 0;
            }
            while (1) {
              var $i_3;
              if ($i_3 >>> 0 >= $size >>> 0) {
                var $cell_end_0_in = $i_3;
                break;
              }
              if (HEAP8[$data + $i_3 | 0] << 24 >> 24 == 124) {
                var $cell_end_0_in = $i_3;
                break;
              }
              var $i_3 = $i_3 + 1 | 0;
            }
            while (1) {
              var $cell_end_0_in;
              var $cell_end_0 = $cell_end_0_in - 1 | 0;
              if ($cell_end_0 >>> 0 <= $i_2 >>> 0) {
                break;
              }
              var $41 = HEAPU8[$data + $cell_end_0 | 0] & 255;
              var $42 = __isspace($41);
              if (($42 | 0) == 0) {
                break;
              }
              var $cell_end_0_in = $cell_end_0;
            }
            var $44 = $data + $i_2 | 0;
            _parse_inline($21, $rndr, $44, $cell_end_0_in - $i_2 | 0);
            var $46 = HEAP32[$1$s2];
            var $49 = HEAP32[$col_data + ($col_07 << 2) >> 2] | $header_flag;
            var $50 = HEAP32[$16 >> 2];
            FUNCTION_TABLE[$46]($9, $21, $49, $50);
            _rndr_popbuf($rndr, 1);
            var $51 = $i_3 + 1 | 0;
            var $52 = $col_07 + 1 | 0;
            if (!($52 >>> 0 < $columns >>> 0 & $51 >>> 0 < $size >>> 0)) {
              var $col_0_lcssa = $52;
              break $_$197;
            }
            var $i_16 = $51;
            var $col_07 = $52;
          }
        } else {
          var $col_0_lcssa = 0;
        }
      } while (0);
      var $col_0_lcssa;
      var $17 = $col_0_lcssa >>> 0 < $columns >>> 0;
      $_$212 : do {
        if ($17) {
          var $18$s2 = $empty_cell >> 2;
          var $19 = $rndr + 104 | 0;
          var $col_14 = $col_0_lcssa;
          while (1) {
            var $col_14;
            HEAP32[$18$s2] = 0;
            HEAP32[$18$s2 + 1] = 0;
            HEAP32[$18$s2 + 2] = 0;
            HEAP32[$18$s2 + 3] = 0;
            var $55 = HEAP32[$1$s2];
            var $58 = HEAP32[$col_data + ($col_14 << 2) >> 2] | $header_flag;
            var $59 = HEAP32[$19 >> 2];
            FUNCTION_TABLE[$55]($9, $empty_cell, $58, $59);
            var $60 = $col_14 + 1 | 0;
            if (($60 | 0) == ($columns | 0)) {
              var $_pre_phi = $19;
              break $_$212;
            }
            var $col_14 = $60;
          }
        } else {
          var $_pre_phi = $rndr + 104 | 0;
        }
      } while (0);
      var $_pre_phi;
      var $61 = HEAP32[$5 >> 2];
      var $62 = HEAP32[$_pre_phi >> 2];
      FUNCTION_TABLE[$61]($ob, $9, $62);
      _rndr_popbuf($rndr, 1);
    }
  } while (0);
  STACKTOP = __stackBase__;
  return;
  return;
}

_parse_table_row["X"] = 1;

function _stack_pop($st) {
  var $1 = $st + 4 | 0;
  var $2 = HEAP32[$1 >> 2];
  if (($2 | 0) == 0) {
    var $_0 = 0;
  } else {
    var $5 = $2 - 1 | 0;
    HEAP32[$1 >> 2] = $5;
    var $_0 = HEAP32[HEAP32[$st >> 2] + ($5 << 2) >> 2];
  }
  var $_0;
  return $_0;
  return null;
}

function _stack_top($st) {
  var $2 = HEAP32[$st + 4 >> 2];
  if (($2 | 0) == 0) {
    var $_0 = 0;
  } else {
    var $_0 = HEAP32[HEAP32[$st >> 2] + ($2 - 1 << 2) >> 2];
  }
  var $_0;
  return $_0;
  return null;
}

function _htmlblock_end($curtag, $data, $size, $start_of_line) {
  var __label__;
  var $1 = _strlen($curtag);
  var $2 = ($start_of_line | 0) == 0;
  var $3 = $1 + 3 | 0;
  var $4 = $size + 1 | 0;
  $_$2 : do {
    if ($2) {
      var $i_0 = 1;
      while (1) {
        var $i_0;
        if ($i_0 >>> 0 >= $size >>> 0) {
          var $_0 = 0;
          __label__ = 18;
          break $_$2;
        }
        var $i_1_in = $i_0;
        while (1) {
          var $i_1_in;
          var $i_1 = $i_1_in + 1 | 0;
          if ($i_1 >>> 0 >= $size >>> 0) {
            break;
          }
          if (HEAP8[$data + $i_1_in | 0] << 24 >> 24 != 60) {
            var $i_1_in = $i_1;
            continue;
          }
          if (HEAP8[$data + $i_1 | 0] << 24 >> 24 == 47) {
            break;
          }
          var $i_1_in = $i_1;
        }
        if (($3 + $i_1_in | 0) >>> 0 >= $size >>> 0) {
          var $_0 = 0;
          __label__ = 18;
          break $_$2;
        }
        var $41 = $data + $i_1_in | 0;
        var $42 = $4 + ($i_1_in ^ -1) | 0;
        var $43 = _htmlblock_end_tag($curtag, $1, $41, $42);
        if (($43 | 0) != 0) {
          var $_lcssa = $43;
          var $i_1_in_lcssa_lcssa = $i_1_in;
          __label__ = 17;
          break $_$2;
        }
        var $i_0 = $i_1;
      }
    } else {
      var $block_lines_0_us = 0;
      var $i_0_us = 1;
      while (1) {
        var $i_0_us;
        var $block_lines_0_us;
        if ($i_0_us >>> 0 >= $size >>> 0) {
          var $_0 = 0;
          __label__ = 18;
          break $_$2;
        }
        var $block_lines_1_us = $block_lines_0_us;
        var $i_1_in_us = $i_0_us;
        while (1) {
          var $i_1_in_us;
          var $block_lines_1_us;
          var $i_1_us = $i_1_in_us + 1 | 0;
          if ($i_1_us >>> 0 >= $size >>> 0) {
            break;
          }
          var $28 = HEAPU8[$data + $i_1_us | 0];
          if (HEAP8[$data + $i_1_in_us | 0] << 24 >> 24 == 60 & $28 << 24 >> 24 == 47) {
            break;
          }
          var $block_lines_1_us = ($28 << 24 >> 24 == 10 & 1) + $block_lines_1_us | 0;
          var $i_1_in_us = $i_1_us;
        }
        if (($block_lines_1_us | 0) > 0) {
          if (HEAP8[$data + ($i_1_in_us - 1) | 0] << 24 >> 24 != 10) {
            var $block_lines_0_us = $block_lines_1_us;
            var $i_0_us = $i_1_us;
            continue;
          }
        }
        if (($3 + $i_1_in_us | 0) >>> 0 >= $size >>> 0) {
          var $_0 = 0;
          __label__ = 18;
          break $_$2;
        }
        var $7 = $data + $i_1_in_us | 0;
        var $8 = $4 + ($i_1_in_us ^ -1) | 0;
        var $9 = _htmlblock_end_tag($curtag, $1, $7, $8);
        if (($9 | 0) != 0) {
          var $_lcssa = $9;
          var $i_1_in_lcssa_lcssa = $i_1_in_us;
          __label__ = 17;
          break $_$2;
        }
        var $block_lines_0_us = $block_lines_1_us;
        var $i_0_us = $i_1_us;
      }
    }
  } while (0);
  if (__label__ == 17) {
    var $i_1_in_lcssa_lcssa;
    var $_lcssa;
    var $_0 = $_lcssa + $i_1_in_lcssa_lcssa | 0;
  }
  var $_0;
  return $_0;
  return null;
}

_htmlblock_end["X"] = 1;

function _htmlblock_end_tag($tag, $tag_len, $data, $size) {
  var $1 = $tag_len + 3 | 0;
  var $2 = $1 >>> 0 < $size >>> 0;
  do {
    if ($2) {
      var $4 = $data + 2 | 0;
      var $5 = _strncasecmp($4, $tag, $tag_len);
      if (($5 | 0) != 0) {
        var $_0 = 0;
        break;
      }
      if (HEAP8[$tag_len + ($data + 2) | 0] << 24 >> 24 != 62) {
        var $_0 = 0;
        break;
      }
      var $13 = $data + $1 | 0;
      var $14 = $size - $1 | 0;
      var $15 = _is_empty($13, $14);
      if (($15 | 0) == 0) {
        var $_0 = 0;
        break;
      }
      var $18 = $15 + $1 | 0;
      if ($18 >>> 0 < $size >>> 0) {
        var $21 = $data + $18 | 0;
        var $22 = $size - $18 | 0;
        var $23 = _is_empty($21, $22);
        var $w_1 = $23;
      } else {
        var $w_1 = 0;
      }
      var $w_1;
      var $_0 = $w_1 + $18 | 0;
    } else {
      var $_0 = 0;
    }
  } while (0);
  var $_0;
  return $_0;
  return null;
}

function _add_link_ref($references, $name, $name_size) {
  var $1 = _calloc(1, 16);
  var $2 = $1;
  if (($1 | 0) == 0) {
    var $_0 = 0;
  } else {
    var $5 = _hash_link_ref($name, $name_size);
    HEAP32[$1 >> 2] = $5;
    var $8 = (($5 & 7) << 2) + $references | 0;
    var $9 = HEAP32[$8 >> 2];
    HEAP32[$1 + 12 >> 2] = $9;
    HEAP32[$8 >> 2] = $2;
    var $_0 = $2;
  }
  var $_0;
  return $_0;
  return null;
}

function _stack_grow($st, $new_size) {
  var $1$s2;
  var $1$s2 = ($st + 8 | 0) >> 2;
  var $3 = HEAPU32[$1$s2] >>> 0 < $new_size >>> 0;
  do {
    if ($3) {
      var $5 = $st | 0;
      var $7 = HEAP32[$5 >> 2];
      var $8 = $new_size << 2;
      var $9 = _realloc($7, $8);
      var $10 = $9;
      if (($9 | 0) == 0) {
        var $_0 = -1;
        break;
      }
      var $13 = HEAP32[$1$s2];
      var $15 = ($13 << 2) + $10 | 0;
      var $17 = $new_size - $13 << 2;
      _memset($15, 0, $17, 4);
      HEAP32[$5 >> 2] = $10;
      HEAP32[$1$s2] = $new_size;
      var $18 = $st + 4 | 0;
      if (HEAPU32[$18 >> 2] >>> 0 <= $new_size >>> 0) {
        var $_0 = 0;
        break;
      }
      HEAP32[$18 >> 2] = $new_size;
      var $_0 = 0;
    } else {
      var $_0 = 0;
    }
  } while (0);
  var $_0;
  return $_0;
  return null;
}

function _stack_free($st) {
  if (($st | 0) != 0) {
    var $3 = $st | 0;
    var $5 = HEAP32[$3 >> 2];
    _free($5);
    HEAP32[$3 >> 2] = 0;
    HEAP32[$st + 4 >> 2] = 0;
    HEAP32[$st + 8 >> 2] = 0;
  }
  return;
  return;
}

function _stack_init($st, $initial_size) {
  HEAP32[$st >> 2] = 0;
  HEAP32[$st + 4 >> 2] = 0;
  HEAP32[$st + 8 >> 2] = 0;
  var $_initial_size = ($initial_size | 0) == 0 ? 8 : $initial_size;
  var $5 = _stack_grow($st, $_initial_size);
  return $5;
  return null;
}

function _stack_push($st, $item) {
  var $1$s2;
  var $1$s2 = ($st + 4 | 0) >> 2;
  var $3 = HEAP32[$1$s2] << 1;
  var $4 = _stack_grow($st, $3);
  if (($4 | 0) < 0) {
    var $_0 = -1;
  } else {
    var $7 = HEAP32[$1$s2];
    var $8 = $7 + 1 | 0;
    HEAP32[$1$s2] = $8;
    var $11 = ($7 << 2) + HEAP32[$st >> 2] | 0;
    HEAP32[$11 >> 2] = $item;
    var $_0 = 0;
  }
  var $_0;
  return $_0;
  return null;
}

function _bufprefix($buf, $prefix) {
  var __label__;
  var $1 = ($buf | 0) == 0;
  do {
    if ($1) {
      __label__ = 4;
    } else {
      if ((HEAP32[$buf + 12 >> 2] | 0) == 0) {
        __label__ = 4;
        break;
      }
      __label__ = 5;
      break;
    }
  } while (0);
  if (__label__ == 4) {
    ___assert_func(STRING_TABLE.__str31 | 0, 38, STRING_TABLE.___func___bufprefix | 0, STRING_TABLE.__str132 | 0);
  }
  var $8 = HEAPU32[$buf + 4 >> 2];
  var $9 = $buf | 0;
  var $i_0 = 0;
  while (1) {
    var $i_0;
    if ($i_0 >>> 0 >= $8 >>> 0) {
      var $_0 = 0;
      break;
    }
    var $14 = HEAP8[$prefix + $i_0 | 0];
    var $15 = $14 << 24 >> 24;
    if ($14 << 24 >> 24 == 0) {
      var $_0 = 0;
      break;
    }
    var $21 = HEAPU8[HEAP32[$9 >> 2] + $i_0 | 0] & 255;
    if (($21 | 0) == ($15 | 0)) {
      var $i_0 = $i_0 + 1 | 0;
      continue;
    }
    var $_0 = $21 - $15 | 0;
    break;
  }
  var $_0;
  return $_0;
  return null;
}

function _bufgrow($buf, $neosz) {
  var __label__;
  var $1 = ($buf | 0) == 0;
  do {
    if ($1) {
      __label__ = 4;
    } else {
      if ((HEAP32[$buf + 12 >> 2] | 0) == 0) {
        __label__ = 4;
        break;
      }
      __label__ = 5;
      break;
    }
  } while (0);
  if (__label__ == 4) {
    ___assert_func(STRING_TABLE.__str31 | 0, 58, STRING_TABLE.___func___bufgrow | 0, STRING_TABLE.__str132 | 0);
  }
  var $8 = $neosz >>> 0 > 16777216;
  do {
    if ($8) {
      var $_0 = -1;
    } else {
      var $10 = $buf + 8 | 0;
      var $11 = HEAPU32[$10 >> 2];
      if ($11 >>> 0 >= $neosz >>> 0) {
        var $_0 = 0;
        break;
      }
      var $15 = HEAPU32[$buf + 12 >> 2];
      var $16 = $15 + $11 | 0;
      var $17 = $16 >>> 0 < $neosz >>> 0;
      $_$83 : do {
        if ($17) {
          var $neoasz_01 = $16;
          while (1) {
            var $neoasz_01;
            var $18 = $15 + $neoasz_01 | 0;
            if ($18 >>> 0 >= $neosz >>> 0) {
              var $neoasz_0_lcssa = $18;
              break $_$83;
            }
            var $neoasz_01 = $18;
          }
        } else {
          var $neoasz_0_lcssa = $16;
        }
      } while (0);
      var $neoasz_0_lcssa;
      var $20 = $buf | 0;
      var $21 = HEAP32[$20 >> 2];
      var $22 = _realloc($21, $neoasz_0_lcssa);
      if (($22 | 0) == 0) {
        var $_0 = -1;
        break;
      }
      HEAP32[$20 >> 2] = $22;
      HEAP32[$10 >> 2] = $neoasz_0_lcssa;
      var $_0 = 0;
    }
  } while (0);
  var $_0;
  return $_0;
  return null;
}

function _bufnew($unit) {
  var $1$s2;
  var $1 = _malloc(16), $1$s2 = $1 >> 2;
  var $2 = $1;
  if (($1 | 0) != 0) {
    HEAP32[$1$s2] = 0;
    HEAP32[$1$s2 + 2] = 0;
    HEAP32[$1$s2 + 1] = 0;
    HEAP32[$1$s2 + 3] = $unit;
  }
  return $2;
  return null;
}

function _bufcstr($buf) {
  var __label__;
  var $1 = ($buf | 0) == 0;
  do {
    if ($1) {
      __label__ = 4;
    } else {
      if ((HEAP32[$buf + 12 >> 2] | 0) == 0) {
        __label__ = 4;
        break;
      }
      __label__ = 5;
      break;
    }
  } while (0);
  if (__label__ == 4) {
    ___assert_func(STRING_TABLE.__str31 | 0, 99, STRING_TABLE.___func___bufcstr | 0, STRING_TABLE.__str132 | 0);
  }
  var $8 = $buf + 4 | 0;
  var $9 = HEAPU32[$8 >> 2];
  var $11 = HEAPU32[$buf + 8 >> 2];
  var $12 = $9 >>> 0 < $11 >>> 0;
  do {
    if ($12) {
      var $15 = HEAPU32[$buf >> 2];
      if (HEAP8[$15 + $9 | 0] << 24 >> 24 == 0) {
        var $_0 = $15;
        __label__ = 11;
        break;
      }
      __label__ = 7;
      break;
    } else {
      __label__ = 7;
    }
  } while (0);
  do {
    if (__label__ == 7) {
      var $20 = $9 + 1 | 0;
      if ($20 >>> 0 > $11 >>> 0) {
        var $23 = _bufgrow($buf, $20);
        if (($23 | 0) != 0) {
          var $_0 = 0;
          break;
        }
        var $25 = HEAP32[$8 >> 2];
      } else {
        var $25 = $9;
      }
      var $25;
      var $26 = $buf | 0;
      HEAP8[HEAP32[$26 >> 2] + $25 | 0] = 0;
      var $_0 = HEAP32[$26 >> 2];
    }
  } while (0);
  var $_0;
  return $_0;
  return null;
}

function _bufprintf($buf, $fmt) {
  var $10$s2;
  var $8$s2;
  var __stackBase__ = STACKTOP;
  STACKTOP += 4;
  assert(STACKTOP % 4 == 0, "Stack is unaligned");
  assert(STACKTOP < STACK_MAX, "Ran out of stack");
  var __label__;
  var $ap = __stackBase__;
  var $1 = ($buf | 0) == 0;
  do {
    if ($1) {
      __label__ = 4;
    } else {
      if ((HEAP32[$buf + 12 >> 2] | 0) == 0) {
        __label__ = 4;
        break;
      }
      __label__ = 5;
      break;
    }
  } while (0);
  if (__label__ == 4) {
    ___assert_func(STRING_TABLE.__str31 | 0, 119, STRING_TABLE.___func___bufprintf | 0, STRING_TABLE.__str132 | 0);
  }
  var $8$s2 = ($buf + 4 | 0) >> 2;
  var $9 = HEAPU32[$8$s2];
  var $10$s2 = ($buf + 8 | 0) >> 2;
  var $12 = $9 >>> 0 < HEAPU32[$10$s2] >>> 0;
  do {
    if ($12) {
      __label__ = 7;
    } else {
      var $14 = $9 + 1 | 0;
      var $15 = _bufgrow($buf, $14);
      if (($15 | 0) < 0) {
        __label__ = 13;
        break;
      }
      __label__ = 7;
      break;
    }
  } while (0);
  do {
    if (__label__ == 7) {
      var $18 = $ap;
      HEAP32[$18 >> 2] = arguments[_bufprintf.length];
      var $19 = $buf | 0;
      var $21 = HEAP32[$8$s2];
      var $22 = HEAP32[$19 >> 2] + $21 | 0;
      var $24 = HEAP32[$10$s2] - $21 | 0;
      var $25 = HEAP32[$ap >> 2];
      var $26 = _vsnprintf($22, $24, $fmt, $25);
      if (($26 | 0) < 0) {
        break;
      }
      var $30 = HEAPU32[$8$s2];
      if ($26 >>> 0 < (HEAP32[$10$s2] - $30 | 0) >>> 0) {
        var $n_01 = $26;
        var $47 = $30;
      } else {
        var $35 = $30 + ($26 + 1) | 0;
        var $36 = _bufgrow($buf, $35);
        if (($36 | 0) < 0) {
          break;
        }
        HEAP32[$18 >> 2] = arguments[_bufprintf.length];
        var $40 = HEAP32[$8$s2];
        var $41 = HEAP32[$19 >> 2] + $40 | 0;
        var $43 = HEAP32[$10$s2] - $40 | 0;
        var $44 = HEAP32[$ap >> 2];
        var $45 = _vsnprintf($41, $43, $fmt, $44);
        if (($45 | 0) < 0) {
          break;
        }
        var $n_01 = $45;
        var $47 = HEAP32[$8$s2];
      }
      var $47;
      var $n_01;
      HEAP32[$8$s2] = $47 + $n_01 | 0;
    }
  } while (0);
  STACKTOP = __stackBase__;
  return;
  return;
}

_bufprintf["X"] = 1;

function _bufput($buf, $data, $len) {
  var $8$s2;
  var __label__;
  var $1 = ($buf | 0) == 0;
  do {
    if ($1) {
      __label__ = 4;
    } else {
      if ((HEAP32[$buf + 12 >> 2] | 0) == 0) {
        __label__ = 4;
        break;
      }
      __label__ = 5;
      break;
    }
  } while (0);
  if (__label__ == 4) {
    ___assert_func(STRING_TABLE.__str31 | 0, 157, STRING_TABLE.___func___bufput | 0, STRING_TABLE.__str132 | 0);
  }
  var $8$s2 = ($buf + 4 | 0) >> 2;
  var $9 = HEAPU32[$8$s2];
  var $10 = $9 + $len | 0;
  var $13 = $10 >>> 0 > HEAPU32[$buf + 8 >> 2] >>> 0;
  do {
    if ($13) {
      var $15 = _bufgrow($buf, $10);
      if (($15 | 0) < 0) {
        __label__ = 9;
        break;
      }
      var $18 = HEAP32[$8$s2];
      __label__ = 8;
      break;
    }
    var $18 = $9;
    __label__ = 8;
  } while (0);
  if (__label__ == 8) {
    var $18;
    var $21 = HEAP32[$buf >> 2] + $18 | 0;
    assert($len % 1 === 0, "memcpy given " + $len + " bytes to copy. Problem with quantum=1 corrections perhaps?");
    _memcpy($21, $data, $len, 1);
    var $23 = HEAP32[$8$s2] + $len | 0;
    HEAP32[$8$s2] = $23;
  }
  return;
  return;
}

function _bufputs($buf, $str) {
  var $1 = _strlen($str);
  _bufput($buf, $str, $1);
  return;
  return;
}

function _bufputc($buf, $c) {
  var $8$s2;
  var __label__;
  var $1 = ($buf | 0) == 0;
  do {
    if ($1) {
      __label__ = 4;
    } else {
      if ((HEAP32[$buf + 12 >> 2] | 0) == 0) {
        __label__ = 4;
        break;
      }
      __label__ = 5;
      break;
    }
  } while (0);
  if (__label__ == 4) {
    ___assert_func(STRING_TABLE.__str31 | 0, 178, STRING_TABLE.___func___bufputc | 0, STRING_TABLE.__str132 | 0);
  }
  var $8$s2 = ($buf + 4 | 0) >> 2;
  var $9 = HEAPU32[$8$s2];
  var $10 = $9 + 1 | 0;
  var $13 = $10 >>> 0 > HEAPU32[$buf + 8 >> 2] >>> 0;
  do {
    if ($13) {
      var $15 = _bufgrow($buf, $10);
      if (($15 | 0) < 0) {
        __label__ = 9;
        break;
      }
      var $18 = HEAP32[$8$s2];
      __label__ = 8;
      break;
    }
    var $18 = $9;
    __label__ = 8;
  } while (0);
  if (__label__ == 8) {
    var $18;
    HEAP8[HEAP32[$buf >> 2] + $18 | 0] = $c & 255;
    var $24 = HEAP32[$8$s2] + 1 | 0;
    HEAP32[$8$s2] = $24;
  }
  return;
  return;
}

function _bufrelease($buf) {
  if (($buf | 0) != 0) {
    var $4 = HEAP32[$buf >> 2];
    _free($4);
    var $5 = $buf;
    _free($5);
  }
  return;
  return;
}

function _bufreset($buf) {
  if (($buf | 0) != 0) {
    var $3 = $buf | 0;
    var $4 = HEAP32[$3 >> 2];
    _free($4);
    HEAP32[$3 >> 2] = 0;
    HEAP32[$buf + 8 >> 2] = 0;
    HEAP32[$buf + 4 >> 2] = 0;
  }
  return;
  return;
}

function _bufslurp($buf, $len) {
  var $8$s2;
  var __label__;
  var $1 = ($buf | 0) == 0;
  do {
    if ($1) {
      __label__ = 4;
    } else {
      if ((HEAP32[$buf + 12 >> 2] | 0) == 0) {
        __label__ = 4;
        break;
      }
      __label__ = 5;
      break;
    }
  } while (0);
  if (__label__ == 4) {
    ___assert_func(STRING_TABLE.__str31 | 0, 215, STRING_TABLE.___func___bufslurp | 0, STRING_TABLE.__str132 | 0);
  }
  var $8$s2 = ($buf + 4 | 0) >> 2;
  var $9 = HEAPU32[$8$s2];
  if ($9 >>> 0 > $len >>> 0) {
    var $13 = $9 - $len | 0;
    HEAP32[$8$s2] = $13;
    var $15 = HEAP32[$buf >> 2];
    var $16 = $15 + $len | 0;
    _llvm_memmove_p0i8_p0i8_i32($15, $16, $13, 1, 0);
  } else {
    HEAP32[$8$s2] = 0;
  }
  return;
  return;
}

function _sd_autolink_issafe($link, $link_len) {
  var $i_0 = 0;
  $_$169 : while (1) {
    var $i_0;
    if ($i_0 >>> 0 >= 5) {
      var $_0 = 0;
      break;
    }
    var $5 = HEAPU32[_sd_autolink_issafe_valid_uris + ($i_0 << 2) >> 2];
    var $6 = _strlen($5);
    var $7 = $6 >>> 0 < $link_len >>> 0;
    do {
      if ($7) {
        var $9 = _strncasecmp($link, $5, $6);
        if (($9 | 0) != 0) {
          break;
        }
        var $14 = HEAPU8[$link + $6 | 0] & 255;
        var $15 = _isalnum($14);
        if (($15 | 0) != 0) {
          var $_0 = 1;
          break $_$169;
        }
      }
    } while (0);
    var $i_0 = $i_0 + 1 | 0;
  }
  var $_0;
  return $_0;
  return null;
}

function _sd_autolink__www($rewind_p, $link, $data, $offset, $size) {
  var __label__;
  var $1 = ($offset | 0) == 0;
  do {
    if ($1) {
      __label__ = 5;
    } else {
      var $3 = $data - 1 | 0;
      var $5 = HEAPU8[$3] & 255;
      var $6 = _ispunct($5);
      if (($6 | 0) != 0) {
        __label__ = 5;
        break;
      }
      var $10 = HEAPU8[$3] & 255;
      var $11 = _isspace($10);
      if (($11 | 0) == 0 | $size >>> 0 < 4) {
        var $_0 = 0;
        __label__ = 12;
        break;
      }
      __label__ = 6;
      break;
    }
  } while (0);
  do {
    if (__label__ == 5) {
      if ($size >>> 0 < 4) {
        var $_0 = 0;
        __label__ = 12;
        break;
      }
      __label__ = 6;
      break;
    }
  } while (0);
  do {
    if (__label__ == 6) {
      var $16 = _memcmp($data, STRING_TABLE.__str550 | 0, 4);
      if (($16 | 0) != 0) {
        var $_0 = 0;
        break;
      }
      var $19 = _check_domain($data, $size);
      if (($19 | 0) == 0) {
        var $_0 = 0;
        break;
      }
      var $link_end_0 = $19;
      while (1) {
        var $link_end_0;
        if ($link_end_0 >>> 0 >= $size >>> 0) {
          break;
        }
        var $25 = HEAPU8[$data + $link_end_0 | 0] & 255;
        var $26 = _isspace($25);
        if (($26 | 0) != 0) {
          break;
        }
        var $link_end_0 = $link_end_0 + 1 | 0;
      }
      var $29 = _autolink_delim($data, $link_end_0);
      if (($29 | 0) == 0) {
        var $_0 = 0;
        break;
      }
      _bufput($link, $data, $29);
      HEAP32[$rewind_p >> 2] = 0;
      var $_0 = $29;
    }
  } while (0);
  var $_0;
  return $_0;
  return null;
}

function _check_domain($data, $size) {
  var $2 = HEAPU8[$data] & 255;
  var $3 = _isalnum($2);
  if (($3 | 0) == 0) {
    var $_0 = 0;
  } else {
    var $5 = $size - 1 | 0;
    var $np_0 = 0;
    var $i_0 = 1;
    $_$195 : while (1) {
      var $i_0;
      var $np_0;
      if ($i_0 >>> 0 >= $5 >>> 0) {
        break;
      }
      var $9 = $data + $i_0 | 0;
      var $10 = HEAPU8[$9];
      var $11 = $10 << 24 >> 24 == 46;
      do {
        if ($11) {
          var $np_1 = $np_0 + 1 | 0;
        } else {
          var $15 = $10 & 255;
          var $16 = _isalnum($15);
          if (($16 | 0) != 0) {
            var $np_1 = $np_0;
            break;
          }
          if (HEAP8[$9] << 24 >> 24 != 45) {
            break $_$195;
          }
          var $np_1 = $np_0;
        }
      } while (0);
      var $np_1;
      var $np_0 = $np_1;
      var $i_0 = $i_0 + 1 | 0;
    }
    var $25 = ($np_0 | 0) != 0 ? $i_0 : 0;
    var $_0 = $25;
  }
  var $_0;
  return $_0;
  return null;
}

function _autolink_delim($data, $link_end) {
  var __label__;
  var $i_0 = 0;
  while (1) {
    var $i_0;
    if ($i_0 >>> 0 >= $link_end >>> 0) {
      var $_01 = $link_end;
      break;
    }
    if (HEAP8[$data + $i_0 | 0] << 24 >> 24 == 60) {
      var $_01 = $i_0;
      break;
    }
    var $i_0 = $i_0 + 1 | 0;
  }
  while (1) {
    var $_01;
    if (($_01 | 0) == 0) {
      var $_0 = 0;
      __label__ = 24;
      break;
    }
    var $9 = $_01 - 1 | 0;
    var $11 = HEAPU8[$data + $9 | 0];
    var $12 = $11 & 255;
    var $memchr = _memchr(STRING_TABLE.__str752 | 0, $12, 5);
    if (($memchr | 0) != 0) {
      var $_01 = $9;
      continue;
    }
    if ($11 << 24 >> 24 != 59) {
      __label__ = 14;
      break;
    }
    var $17 = $_01 - 2 | 0;
    var $new_end_0 = $17;
    while (1) {
      var $new_end_0;
      if (($new_end_0 | 0) == 0) {
        break;
      }
      var $23 = HEAPU8[$data + $new_end_0 | 0] & 255;
      var $24 = _isalpha($23);
      if (($24 | 0) == 0) {
        break;
      }
      var $new_end_0 = $new_end_0 - 1 | 0;
    }
    if ($new_end_0 >>> 0 < $17 >>> 0) {
      if (HEAP8[$data + $new_end_0 | 0] << 24 >> 24 == 38) {
        var $_01 = $new_end_0;
        continue;
      }
    }
    var $_01 = $9;
  }
  do {
    if (__label__ == 14) {
      if (($12 | 0) == 34 || ($12 | 0) == 39) {
        var $copen_01_ph = $12;
      } else if (($12 | 0) == 41) {
        var $copen_01_ph = 40;
      } else if (($12 | 0) == 93) {
        var $copen_01_ph = 91;
      } else if (($12 | 0) == 125) {
        var $copen_01_ph = 123;
      } else {
        var $_0 = $_01;
        break;
      }
      var $copen_01_ph;
      var $closing_03 = 0;
      var $opening_04 = 0;
      var $i1_05 = 0;
      while (1) {
        var $i1_05;
        var $opening_04;
        var $closing_03;
        var $39 = HEAPU8[$data + $i1_05 | 0];
        if (($39 & 255 | 0) == ($copen_01_ph | 0)) {
          var $opening_1 = $opening_04 + 1 | 0;
          var $closing_1 = $closing_03;
        } else {
          var $opening_1 = $opening_04;
          var $closing_1 = ($39 << 24 >> 24 == $11 << 24 >> 24 & 1) + $closing_03 | 0;
        }
        var $closing_1;
        var $opening_1;
        var $47 = $i1_05 + 1 | 0;
        if (($47 | 0) == ($_01 | 0)) {
          break;
        }
        var $closing_03 = $closing_1;
        var $opening_04 = $opening_1;
        var $i1_05 = $47;
      }
      var $_01_ = ($closing_1 | 0) == ($opening_1 | 0) ? $_01 : $9;
      return $_01_;
    }
  } while (0);
  var $_0;
  return $_0;
  return null;
}

_autolink_delim["X"] = 1;

function _sd_autolink__email($rewind_p, $link, $data, $offset, $size) {
  var $rewind_0 = 0;
  while (1) {
    var $rewind_0;
    if ($rewind_0 >>> 0 >= $offset >>> 0) {
      break;
    }
    var $7 = HEAPU8[$data + ($rewind_0 ^ -1) | 0] & 255;
    var $8 = _isalnum($7);
    if (($8 | 0) == 0) {
      var $memchr = _memchr(STRING_TABLE.__str651 | 0, $7, 5);
      if (($memchr | 0) == 0) {
        break;
      }
    }
    var $rewind_0 = $rewind_0 + 1 | 0;
  }
  var $15 = ($rewind_0 | 0) == 0;
  do {
    if ($15) {
      var $_0 = 0;
    } else {
      var $16 = $size - 1 | 0;
      var $np_0 = 0;
      var $nb_0 = 0;
      var $link_end_0 = 0;
      $_$42 : while (1) {
        var $link_end_0;
        var $nb_0;
        var $np_0;
        if ($link_end_0 >>> 0 >= $size >>> 0) {
          break;
        }
        var $21 = HEAPU8[$data + $link_end_0 | 0];
        var $22 = $21 & 255;
        var $23 = _isalnum($22);
        var $24 = ($23 | 0) == 0;
        do {
          if ($24) {
            if ($21 << 24 >> 24 == 64) {
              var $np_1 = $np_0;
              var $nb_1 = $nb_0 + 1 | 0;
            } else if ($21 << 24 >> 24 == 46) {
              if ($link_end_0 >>> 0 >= $16 >>> 0) {
                break $_$42;
              }
              var $np_1 = $np_0 + 1 | 0;
              var $nb_1 = $nb_0;
            } else if ($21 << 24 >> 24 == 45 || $21 << 24 >> 24 == 95) {
              var $np_1 = $np_0;
              var $nb_1 = $nb_0;
              break;
            } else {
              break $_$42;
            }
          } else {
            var $np_1 = $np_0;
            var $nb_1 = $nb_0;
          }
        } while (0);
        var $nb_1;
        var $np_1;
        var $np_0 = $np_1;
        var $nb_0 = $nb_1;
        var $link_end_0 = $link_end_0 + 1 | 0;
      }
      if (($nb_0 | 0) != 1 | $link_end_0 >>> 0 < 2 | ($np_0 | 0) == 0) {
        var $_0 = 0;
        break;
      }
      var $36 = _autolink_delim($data, $link_end_0);
      if (($36 | 0) == 0) {
        var $_0 = 0;
        break;
      }
      var $40 = $data + -$rewind_0 | 0;
      var $41 = $36 + $rewind_0 | 0;
      _bufput($link, $40, $41);
      HEAP32[$rewind_p >> 2] = $rewind_0;
      var $_0 = $36;
    }
  } while (0);
  var $_0;
  return $_0;
  return null;
}

_sd_autolink__email["X"] = 1;

function _sd_autolink__url($rewind_p, $link, $data, $offset, $size) {
  var $1 = $size >>> 0 < 4;
  do {
    if ($1) {
      var $_0 = 0;
    } else {
      if (HEAP8[$data + 1 | 0] << 24 >> 24 != 47) {
        var $_0 = 0;
        break;
      }
      if (HEAP8[$data + 2 | 0] << 24 >> 24 != 47) {
        var $_0 = 0;
        break;
      }
      var $rewind_0 = 0;
      while (1) {
        var $rewind_0;
        if ($rewind_0 >>> 0 >= $offset >>> 0) {
          break;
        }
        var $15 = HEAPU8[$data + ($rewind_0 ^ -1) | 0] & 255;
        var $16 = _isalpha($15);
        if (($16 | 0) == 0) {
          break;
        }
        var $rewind_0 = $rewind_0 + 1 | 0;
      }
      var $20 = $data + -$rewind_0 | 0;
      var $21 = $rewind_0 + $size | 0;
      var $22 = _sd_autolink_issafe($20, $21);
      if (($22 | 0) == 0) {
        var $_0 = 0;
        break;
      }
      var $25 = $data + 3 | 0;
      var $26 = $size - 3 | 0;
      var $27 = _check_domain($25, $26);
      if (($27 | 0) == 0) {
        var $_0 = 0;
        break;
      }
      var $link_end_0 = $27 + 3 | 0;
      while (1) {
        var $link_end_0;
        if ($link_end_0 >>> 0 >= $size >>> 0) {
          break;
        }
        var $36 = HEAPU8[$data + $link_end_0 | 0] & 255;
        var $37 = _isspace($36);
        if (($37 | 0) != 0) {
          break;
        }
        var $link_end_0 = $link_end_0 + 1 | 0;
      }
      var $40 = _autolink_delim($data, $link_end_0);
      if (($40 | 0) == 0) {
        var $_0 = 0;
        break;
      }
      var $43 = $40 + $rewind_0 | 0;
      _bufput($link, $20, $43);
      HEAP32[$rewind_p >> 2] = $rewind_0;
      var $_0 = $40;
    }
  } while (0);
  var $_0;
  return $_0;
  return null;
}

_sd_autolink__url["X"] = 1;

function _sdhtml_is_tag($tag_data, $tag_size, $tagname) {
  var $1 = $tag_size >>> 0 < 3;
  $_$73 : do {
    if ($1) {
      var $_0 = 0;
    } else {
      if (HEAP8[$tag_data] << 24 >> 24 != 60) {
        var $_0 = 0;
        break;
      }
      var $_ = HEAP8[$tag_data + 1 | 0] << 24 >> 24 == 47 ? 2 : 1;
      var $i_0 = $_;
      var $_01 = $tagname;
      while (1) {
        var $_01;
        var $i_0;
        if ($i_0 >>> 0 >= $tag_size >>> 0) {
          break;
        }
        var $12 = HEAPU8[$_01];
        if ($12 << 24 >> 24 == 0) {
          break;
        }
        if ((HEAPU8[$tag_data + $i_0 | 0] & 255 | 0) != ($12 << 24 >> 24 | 0)) {
          var $_0 = 0;
          break $_$73;
        }
        var $i_0 = $i_0 + 1 | 0;
        var $_01 = $_01 + 1 | 0;
      }
      if (($i_0 | 0) == ($tag_size | 0)) {
        var $_0 = 0;
        break;
      }
      var $26 = $tag_data + $i_0 | 0;
      var $28 = HEAPU8[$26] & 255;
      var $29 = _isspace($28);
      if (($29 | 0) == 0) {
        if (HEAP8[$26] << 24 >> 24 != 62) {
          var $_0 = 0;
          break;
        }
      }
      var $_0 = $_;
    }
  } while (0);
  var $_0;
  return $_0;
  return null;
}

function _sdhtml_toc_renderer($callbacks, $options) {
  var $1$s2;
  var $1$s2 = $options >> 2;
  HEAP32[$1$s2] = 0;
  HEAP32[$1$s2 + 1] = 0;
  HEAP32[$1$s2 + 2] = 0;
  HEAP32[$1$s2 + 3] = 0;
  HEAP32[$1$s2 + 4] = 0;
  HEAP32[$options + 12 >> 2] = 64;
  var $3 = $callbacks;
  assert(104 % 1 === 0, "memcpy given " + 104 + " bytes to copy. Problem with quantum=1 corrections perhaps?");
  for (var $$src = _sdhtml_toc_renderer_cb_default >> 2, $$dest = $3 >> 2, $$stop = $$src + 26; $$src < $$stop; $$src++, $$dest++) {
    HEAP32[$$dest] = HEAP32[$$src];
  }
  return;
  return;
}

function _toc_header($ob, $text, $level, $opaque) {
  var $2$s2;
  var $2$s2 = ($opaque + 4 | 0) >> 2;
  var $3 = HEAP32[$2$s2];
  if (($3 | 0) == 0) {
    var $6 = $level - 1 | 0;
    HEAP32[$opaque + 8 >> 2] = $6;
    var $10 = $6;
  } else {
    var $10 = HEAP32[$opaque + 8 >> 2];
  }
  var $10;
  var $11 = $level - $10 | 0;
  var $12 = ($11 | 0) > ($3 | 0);
  $_$93 : do {
    if ($12) {
      while (1) {
        _bufput($ob, STRING_TABLE.__str57 | 0, 10);
        var $14 = HEAP32[$2$s2] + 1 | 0;
        HEAP32[$2$s2] = $14;
        if (($11 | 0) <= ($14 | 0)) {
          break $_$93;
        }
      }
    } else {
      if (($11 | 0) < ($3 | 0)) {
        _bufput($ob, STRING_TABLE.__str2988 | 0, 6);
        var $20 = ($11 | 0) < (HEAP32[$2$s2] | 0);
        $_$99 : do {
          if ($20) {
            while (1) {
              _bufput($ob, STRING_TABLE.__str58 | 0, 12);
              var $22 = HEAP32[$2$s2] - 1 | 0;
              HEAP32[$2$s2] = $22;
              if (($11 | 0) >= ($22 | 0)) {
                break $_$99;
              }
            }
          }
        } while (0);
        _bufput($ob, STRING_TABLE.__str5992 | 0, 5);
      } else {
        _bufput($ob, STRING_TABLE.__str60 | 0, 11);
      }
    }
  } while (0);
  var $25 = $opaque;
  var $26 = HEAP32[$25 >> 2];
  var $27 = $26 + 1 | 0;
  HEAP32[$25 >> 2] = $27;
  _bufprintf($ob, STRING_TABLE.__str61 | 0, (tempInt = STACKTOP, STACKTOP += 4, assert(STACKTOP < STACK_ROOT + STACK_MAX, "Ran out of stack"), HEAP32[tempInt >> 2] = $26, tempInt));
  if (($text | 0) != 0) {
    var $31 = HEAP32[$text >> 2];
    var $33 = HEAP32[$text + 4 >> 2];
    _escape_html($ob, $31, $33);
  }
  _bufput($ob, STRING_TABLE.__str62 | 0, 5);
  return;
  return;
}

_toc_header["X"] = 1;

function _rndr_codespan($ob, $text, $opaque) {
  _bufput($ob, STRING_TABLE.__str55 | 0, 6);
  if (($text | 0) != 0) {
    var $4 = HEAP32[$text >> 2];
    var $6 = HEAP32[$text + 4 >> 2];
    _escape_html($ob, $4, $6);
  }
  _bufput($ob, STRING_TABLE.__str56 | 0, 7);
  return 1;
  return null;
}

function _rndr_double_emphasis($ob, $text, $opaque) {
  var $1 = ($text | 0) == 0;
  do {
    if ($1) {
      var $_0 = 0;
    } else {
      var $3 = $text + 4 | 0;
      if ((HEAP32[$3 >> 2] | 0) == 0) {
        var $_0 = 0;
        break;
      }
      _bufput($ob, STRING_TABLE.__str53 | 0, 8);
      var $8 = HEAP32[$text >> 2];
      var $9 = HEAP32[$3 >> 2];
      _bufput($ob, $8, $9);
      _bufput($ob, STRING_TABLE.__str54 | 0, 9);
      var $_0 = 1;
    }
  } while (0);
  var $_0;
  return $_0;
  return null;
}

function _rndr_emphasis($ob, $text, $opaque) {
  var $1 = ($text | 0) == 0;
  do {
    if ($1) {
      var $_0 = 0;
    } else {
      var $3 = $text + 4 | 0;
      if ((HEAP32[$3 >> 2] | 0) == 0) {
        var $_0 = 0;
        break;
      }
      _bufput($ob, STRING_TABLE.__str51 | 0, 4);
      var $8 = HEAP32[$text >> 2];
      var $9 = HEAP32[$3 >> 2];
      _bufput($ob, $8, $9);
      _bufput($ob, STRING_TABLE.__str52 | 0, 5);
      var $_0 = 1;
    }
  } while (0);
  var $_0;
  return $_0;
  return null;
}

function _toc_link($ob, $link, $title, $content, $opaque) {
  var $1 = ($content | 0) == 0;
  do {
    if (!$1) {
      var $4 = HEAP32[$content + 4 >> 2];
      if (($4 | 0) == 0) {
        break;
      }
      var $8 = HEAP32[$content >> 2];
      _bufput($ob, $8, $4);
    }
  } while (0);
  return 1;
  return null;
}

function _rndr_triple_emphasis($ob, $text, $opaque) {
  var $1 = ($text | 0) == 0;
  do {
    if ($1) {
      var $_0 = 0;
    } else {
      var $3 = $text + 4 | 0;
      if ((HEAP32[$3 >> 2] | 0) == 0) {
        var $_0 = 0;
        break;
      }
      _bufput($ob, STRING_TABLE.__str49 | 0, 12);
      var $8 = HEAP32[$text >> 2];
      var $9 = HEAP32[$3 >> 2];
      _bufput($ob, $8, $9);
      _bufput($ob, STRING_TABLE.__str50 | 0, 14);
      var $_0 = 1;
    }
  } while (0);
  var $_0;
  return $_0;
  return null;
}

function _rndr_strikethrough($ob, $text, $opaque) {
  var $1 = ($text | 0) == 0;
  do {
    if ($1) {
      var $_0 = 0;
    } else {
      var $3 = $text + 4 | 0;
      if ((HEAP32[$3 >> 2] | 0) == 0) {
        var $_0 = 0;
        break;
      }
      _bufput($ob, STRING_TABLE.__str47 | 0, 5);
      var $8 = HEAP32[$text >> 2];
      var $9 = HEAP32[$3 >> 2];
      _bufput($ob, $8, $9);
      _bufput($ob, STRING_TABLE.__str48 | 0, 6);
      var $_0 = 1;
    }
  } while (0);
  var $_0;
  return $_0;
  return null;
}

function _rndr_superscript($ob, $text, $opaque) {
  var $1 = ($text | 0) == 0;
  do {
    if ($1) {
      var $_0 = 0;
    } else {
      var $3 = $text + 4 | 0;
      if ((HEAP32[$3 >> 2] | 0) == 0) {
        var $_0 = 0;
        break;
      }
      _bufput($ob, STRING_TABLE.__str4591 | 0, 5);
      var $8 = HEAP32[$text >> 2];
      var $9 = HEAP32[$3 >> 2];
      _bufput($ob, $8, $9);
      _bufput($ob, STRING_TABLE.__str46 | 0, 6);
      var $_0 = 1;
    }
  } while (0);
  var $_0;
  return $_0;
  return null;
}

function _toc_finalize($ob, $opaque) {
  var $2$s2;
  var $2$s2 = ($opaque + 4 | 0) >> 2;
  var $4 = (HEAP32[$2$s2] | 0) > 0;
  $_$143 : do {
    if ($4) {
      while (1) {
        _bufput($ob, STRING_TABLE.__str44 | 0, 12);
        var $6 = HEAP32[$2$s2] - 1 | 0;
        HEAP32[$2$s2] = $6;
        if (($6 | 0) <= 0) {
          break $_$143;
        }
      }
    }
  } while (0);
  return;
  return;
}

function _sdhtml_renderer($callbacks, $options, $render_flags) {
  var $1$s2;
  var $1$s2 = $options >> 2;
  HEAP32[$1$s2] = 0;
  HEAP32[$1$s2 + 1] = 0;
  HEAP32[$1$s2 + 2] = 0;
  HEAP32[$1$s2 + 3] = 0;
  HEAP32[$1$s2 + 4] = 0;
  HEAP32[$options + 12 >> 2] = $render_flags;
  var $3 = $callbacks;
  assert(104 % 1 === 0, "memcpy given " + 104 + " bytes to copy. Problem with quantum=1 corrections perhaps?");
  for (var $$src = _sdhtml_renderer_cb_default >> 2, $$dest = $3 >> 2, $$stop = $$src + 26; $$src < $$stop; $$src++, $$dest++) {
    HEAP32[$$dest] = HEAP32[$$src];
  }
  if (($render_flags & 4 | 0) != 0) {
    HEAP32[$callbacks + 60 >> 2] = 0;
  }
  if (($render_flags & 8 | 0) != 0) {
    HEAP32[$callbacks + 68 >> 2] = 0;
    HEAP32[$callbacks + 44 >> 2] = 0;
  }
  if (($render_flags & 513 | 0) != 0) {
    HEAP32[$callbacks + 8 >> 2] = 0;
  }
  return;
  return;
}

function _rndr_blockcode($ob, $text, $lang, $opaque) {
  var $14$s2;
  var $8$s2;
  var __label__;
  if ((HEAP32[$ob + 4 >> 2] | 0) != 0) {
    _bufputc($ob, 10);
  }
  var $6 = ($lang | 0) == 0;
  do {
    if (!$6) {
      var $8$s2 = ($lang + 4 | 0) >> 2;
      if ((HEAP32[$8$s2] | 0) == 0) {
        __label__ = 22;
        break;
      }
      _bufput($ob, STRING_TABLE.__str41 | 0, 18);
      var $12 = HEAP32[$8$s2];
      var $13 = ($12 | 0) == 0;
      $_$164 : do {
        if (!$13) {
          var $14$s2 = ($lang | 0) >> 2;
          var $i_03 = 0;
          var $cls_04 = 0;
          var $15 = $12;
          while (1) {
            var $15;
            var $cls_04;
            var $i_03;
            var $i_1 = $i_03;
            var $17 = $15;
            while (1) {
              var $17;
              var $i_1;
              if ($i_1 >>> 0 >= $17 >>> 0) {
                var $27 = $17;
                break;
              }
              var $23 = HEAPU8[HEAP32[$14$s2] + $i_1 | 0] & 255;
              var $24 = _isspace($23);
              if (($24 | 0) == 0) {
                var $27 = HEAP32[$8$s2];
                break;
              }
              var $i_1 = $i_1 + 1 | 0;
              var $17 = HEAP32[$8$s2];
            }
            var $27;
            if ($i_1 >>> 0 < $27 >>> 0) {
              var $i_2 = $i_1;
              var $29 = $27;
              while (1) {
                var $29;
                var $i_2;
                if ($i_2 >>> 0 >= $29 >>> 0) {
                  break;
                }
                var $35 = HEAPU8[HEAP32[$14$s2] + $i_2 | 0] & 255;
                var $36 = _isspace($35);
                if (($36 | 0) != 0) {
                  break;
                }
                var $i_2 = $i_2 + 1 | 0;
                var $29 = HEAP32[$8$s2];
              }
              var $39 = HEAPU32[$14$s2];
              var $_i_1 = (HEAP8[$39 + $i_1 | 0] << 24 >> 24 == 46 & 1) + $i_1 | 0;
              if (($cls_04 | 0) == 0) {
                var $47 = $39;
              } else {
                _bufputc($ob, 32);
                var $47 = HEAP32[$14$s2];
              }
              var $47;
              var $48 = $47 + $_i_1 | 0;
              var $49 = $i_2 - $_i_1 | 0;
              _escape_html($ob, $48, $49);
              var $i_3 = $i_2;
              var $51 = HEAP32[$8$s2];
            } else {
              var $i_3 = $i_1;
              var $51 = $27;
            }
            var $51;
            var $i_3;
            var $52 = $i_3 + 1 | 0;
            if ($52 >>> 0 >= $51 >>> 0) {
              break $_$164;
            }
            var $i_03 = $52;
            var $cls_04 = $cls_04 + 1 | 0;
            var $15 = $51;
          }
        }
      } while (0);
      _bufput($ob, STRING_TABLE.__str564 | 0, 2);
      __label__ = 23;
      break;
    }
    __label__ = 22;
  } while (0);
  if (__label__ == 22) {
    _bufput($ob, STRING_TABLE.__str42 | 0, 11);
  }
  if (($text | 0) != 0) {
    var $60 = HEAP32[$text >> 2];
    var $62 = HEAP32[$text + 4 >> 2];
    _escape_html($ob, $60, $62);
  }
  _bufput($ob, STRING_TABLE.__str43 | 0, 14);
  return;
  return;
}

_rndr_blockcode["X"] = 1;

function _rndr_blockquote($ob, $text, $opaque) {
  if ((HEAP32[$ob + 4 >> 2] | 0) != 0) {
    _bufputc($ob, 10);
  }
  _bufput($ob, STRING_TABLE.__str39 | 0, 13);
  if (($text | 0) != 0) {
    var $9 = HEAP32[$text >> 2];
    var $11 = HEAP32[$text + 4 >> 2];
    _bufput($ob, $9, $11);
  }
  _bufput($ob, STRING_TABLE.__str40 | 0, 14);
  return;
  return;
}

function _rndr_raw_block($ob, $text, $opaque) {
  var $5$s2;
  var $1 = ($text | 0) == 0;
  $_$200 : do {
    if (!$1) {
      var $5$s2 = ($text | 0) >> 2;
      var $sz_0 = HEAP32[$text + 4 >> 2];
      while (1) {
        var $sz_0;
        if (($sz_0 | 0) == 0) {
          var $org_0 = 0;
          break;
        }
        var $9 = $sz_0 - 1 | 0;
        if (HEAP8[HEAP32[$5$s2] + $9 | 0] << 24 >> 24 != 10) {
          var $org_0 = 0;
          break;
        }
        var $sz_0 = $9;
      }
      while (1) {
        var $org_0;
        if ($org_0 >>> 0 >= $sz_0 >>> 0) {
          break $_$200;
        }
        var $16 = HEAPU32[$5$s2];
        if (HEAP8[$16 + $org_0 | 0] << 24 >> 24 != 10) {
          break;
        }
        var $org_0 = $org_0 + 1 | 0;
      }
      if ((HEAP32[$ob + 4 >> 2] | 0) == 0) {
        var $27 = $16;
      } else {
        _bufputc($ob, 10);
        var $27 = HEAP32[$5$s2];
      }
      var $27;
      _bufput($ob, $27 + $org_0 | 0, $sz_0 - $org_0 | 0);
      _bufputc($ob, 10);
    }
  } while (0);
  return;
  return;
}

function _rndr_header($ob, $text, $level, $opaque) {
  if ((HEAP32[$ob + 4 >> 2] | 0) != 0) {
    _bufputc($ob, 10);
  }
  if ((HEAP32[$opaque + 12 >> 2] & 64 | 0) == 0) {
    _bufprintf($ob, STRING_TABLE.__str37 | 0, (tempInt = STACKTOP, STACKTOP += 4, assert(STACKTOP < STACK_ROOT + STACK_MAX, "Ran out of stack"), HEAP32[tempInt >> 2] = $level, tempInt));
  } else {
    var $12 = $opaque;
    var $13 = HEAP32[$12 >> 2];
    var $14 = $13 + 1 | 0;
    HEAP32[$12 >> 2] = $14;
    _bufprintf($ob, STRING_TABLE.__str36 | 0, (tempInt = STACKTOP, STACKTOP += 8, assert(STACKTOP < STACK_ROOT + STACK_MAX, "Ran out of stack"), HEAP32[tempInt >> 2] = $level, HEAP32[tempInt + 4 >> 2] = $13, tempInt));
  }
  if (($text | 0) != 0) {
    var $20 = HEAP32[$text >> 2];
    var $22 = HEAP32[$text + 4 >> 2];
    _bufput($ob, $20, $22);
  }
  _bufprintf($ob, STRING_TABLE.__str38 | 0, (tempInt = STACKTOP, STACKTOP += 4, assert(STACKTOP < STACK_ROOT + STACK_MAX, "Ran out of stack"), HEAP32[tempInt >> 2] = $level, tempInt));
  return;
  return;
}

function _rndr_hrule($ob, $opaque) {
  if ((HEAP32[$ob + 4 >> 2] | 0) != 0) {
    _bufputc($ob, 10);
  }
  var $11 = (HEAP32[$opaque + 12 >> 2] & 256 | 0) != 0 ? STRING_TABLE.__str34 | 0 : STRING_TABLE.__str35 | 0;
  _bufputs($ob, $11);
  return;
  return;
}

function _rndr_list($ob, $text, $flags, $opaque) {
  if ((HEAP32[$ob + 4 >> 2] | 0) != 0) {
    _bufputc($ob, 10);
  }
  var $7 = ($flags & 1 | 0) != 0;
  var $8 = $7 ? STRING_TABLE.__str3089 | 0 : STRING_TABLE.__str3190 | 0;
  _bufput($ob, $8, 5);
  if (($text | 0) != 0) {
    var $12 = HEAP32[$text >> 2];
    var $14 = HEAP32[$text + 4 >> 2];
    _bufput($ob, $12, $14);
  }
  var $16 = $7 ? STRING_TABLE.__str32 | 0 : STRING_TABLE.__str33 | 0;
  _bufput($ob, $16, 6);
  return;
  return;
}

function _rndr_listitem($ob, $text, $flags, $opaque) {
  _bufput($ob, STRING_TABLE.__str2887 | 0, 4);
  if (($text | 0) != 0) {
    var $5 = $text | 0;
    var $size_0 = HEAP32[$text + 4 >> 2];
    while (1) {
      var $size_0;
      if (($size_0 | 0) == 0) {
        var $14 = HEAP32[$5 >> 2];
        break;
      }
      var $9 = $size_0 - 1 | 0;
      var $10 = HEAP32[$5 >> 2];
      if (HEAP8[$10 + $9 | 0] << 24 >> 24 != 10) {
        var $14 = $10;
        break;
      }
      var $size_0 = $9;
    }
    var $14;
    _bufput($ob, $14, $size_0);
  }
  _bufput($ob, STRING_TABLE.__str2988 | 0, 6);
  return;
  return;
}

function _rndr_paragraph($ob, $text, $opaque) {
  var $11$s2;
  var $8$s2;
  if ((HEAP32[$ob + 4 >> 2] | 0) != 0) {
    _bufputc($ob, 10);
  }
  var $6 = ($text | 0) == 0;
  do {
    if (!$6) {
      var $8$s2 = ($text + 4 | 0) >> 2;
      var $9 = HEAP32[$8$s2];
      if (($9 | 0) == 0) {
        break;
      }
      var $11$s2 = ($text | 0) >> 2;
      var $i_0 = 0;
      var $13 = $9;
      while (1) {
        var $13;
        var $i_0;
        if ($i_0 >>> 0 >= $13 >>> 0) {
          var $23 = $13;
          break;
        }
        var $19 = HEAPU8[HEAP32[$11$s2] + $i_0 | 0] & 255;
        var $20 = _isspace($19);
        if (($20 | 0) == 0) {
          var $23 = HEAP32[$8$s2];
          break;
        }
        var $i_0 = $i_0 + 1 | 0;
        var $13 = HEAP32[$8$s2];
      }
      var $23;
      if (($i_0 | 0) == ($23 | 0)) {
        break;
      }
      _bufput($ob, STRING_TABLE.__str2685 | 0, 3);
      var $30 = (HEAP32[$opaque + 12 >> 2] & 128 | 0) == 0;
      $_$26 : do {
        if ($30) {
          var $54 = HEAP32[$11$s2] + $i_0 | 0;
          var $56 = HEAP32[$8$s2] - $i_0 | 0;
          _bufput($ob, $54, $56);
        } else {
          var $i_1 = $i_0;
          while (1) {
            var $i_1;
            var $31 = HEAPU32[$8$s2];
            if ($i_1 >>> 0 >= $31 >>> 0) {
              break $_$26;
            }
            var $i_2 = $i_1;
            while (1) {
              var $i_2;
              if ($i_2 >>> 0 >= $31 >>> 0) {
                break;
              }
              if (HEAP8[HEAP32[$11$s2] + $i_2 | 0] << 24 >> 24 == 10) {
                break;
              }
              var $i_2 = $i_2 + 1 | 0;
            }
            if ($i_2 >>> 0 > $i_1 >>> 0) {
              var $43 = HEAP32[$11$s2] + $i_1 | 0;
              _bufput($ob, $43, $i_2 - $i_1 | 0);
              var $46 = HEAP32[$8$s2];
            } else {
              var $46 = $31;
            }
            var $46;
            if ($i_2 >>> 0 >= ($46 - 1 | 0) >>> 0) {
              break $_$26;
            }
            var $50 = _rndr_linebreak($ob, $opaque);
            var $i_1 = $i_2 + 1 | 0;
          }
        }
      } while (0);
      _bufput($ob, STRING_TABLE.__str2786 | 0, 5);
    }
  } while (0);
  return;
  return;
}

_rndr_paragraph["X"] = 1;

function _rndr_table($ob, $header, $body, $opaque) {
  if ((HEAP32[$ob + 4 >> 2] | 0) != 0) {
    _bufputc($ob, 10);
  }
  _bufput($ob, STRING_TABLE.__str2382 | 0, 15);
  if (($header | 0) != 0) {
    var $9 = HEAP32[$header >> 2];
    var $11 = HEAP32[$header + 4 >> 2];
    _bufput($ob, $9, $11);
  }
  _bufput($ob, STRING_TABLE.__str2483 | 0, 16);
  if (($body | 0) != 0) {
    var $16 = HEAP32[$body >> 2];
    var $18 = HEAP32[$body + 4 >> 2];
    _bufput($ob, $16, $18);
  }
  _bufput($ob, STRING_TABLE.__str2584 | 0, 17);
  return;
  return;
}

function _rndr_tablerow($ob, $text, $opaque) {
  _bufput($ob, STRING_TABLE.__str2180 | 0, 5);
  if (($text | 0) != 0) {
    var $4 = HEAP32[$text >> 2];
    var $6 = HEAP32[$text + 4 >> 2];
    _bufput($ob, $4, $6);
  }
  _bufput($ob, STRING_TABLE.__str2281 | 0, 6);
  return;
  return;
}

function _rndr_tablecell($ob, $text, $flags, $opaque) {
  var __label__;
  var $2 = ($flags & 4 | 0) != 0;
  if ($2) {
    _bufput($ob, STRING_TABLE.__str1372 | 0, 3);
  } else {
    _bufput($ob, STRING_TABLE.__str1473 | 0, 3);
  }
  var $6 = $flags & 3;
  if (($6 | 0) == 3) {
    _bufput($ob, STRING_TABLE.__str1574 | 0, 16);
  } else if (($6 | 0) == 1) {
    _bufput($ob, STRING_TABLE.__str1675 | 0, 14);
  } else if (($6 | 0) == 2) {
    _bufput($ob, STRING_TABLE.__str1776 | 0, 15);
  } else {
    _bufput($ob, STRING_TABLE.__str1877 | 0, 1);
  }
  if (($text | 0) == 0) {
    __label__ = 12;
  } else {
    var $15 = HEAP32[$text >> 2];
    var $17 = HEAP32[$text + 4 >> 2];
    _bufput($ob, $15, $17);
  }
  if ($2) {
    _bufput($ob, STRING_TABLE.__str1978 | 0, 6);
  } else {
    _bufput($ob, STRING_TABLE.__str2079 | 0, 6);
  }
  return;
  return;
}

function _rndr_autolink($ob, $link, $type, $opaque) {
  var $3$s2;
  var $1 = ($link | 0) == 0;
  do {
    if ($1) {
      var $_0 = 0;
    } else {
      var $3$s2 = ($link + 4 | 0) >> 2;
      var $4 = HEAP32[$3$s2];
      if (($4 | 0) == 0) {
        var $_0 = 0;
        break;
      }
      if ((HEAP32[$opaque + 12 >> 2] & 32 | 0) != 0) {
        var $14 = HEAP32[$link >> 2];
        var $15 = _sd_autolink_issafe($14, $4);
        if (!(($15 | 0) != 0 | ($type | 0) == 2)) {
          var $_0 = 0;
          break;
        }
      }
      _bufput($ob, STRING_TABLE.__str362 | 0, 9);
      if (($type | 0) == 2) {
        _bufput($ob, STRING_TABLE.__str1271 | 0, 7);
      }
      var $22 = $link | 0;
      var $23 = HEAP32[$22 >> 2];
      var $24 = HEAP32[$3$s2];
      _escape_href($ob, $23, $24);
      var $26 = $opaque + 16 | 0;
      if ((HEAP32[$26 >> 2] | 0) == 0) {
        _bufput($ob, STRING_TABLE.__str564 | 0, 2);
      } else {
        _bufputc($ob, 34);
        var $30 = HEAP32[$26 >> 2];
        FUNCTION_TABLE[$30]($ob, $link, $opaque);
        _bufputc($ob, 62);
      }
      var $33 = _bufprefix($link, STRING_TABLE.__str1271 | 0);
      var $35 = HEAP32[$22 >> 2];
      if (($33 | 0) == 0) {
        var $37 = $35 + 7 | 0;
        var $39 = HEAP32[$3$s2] - 7 | 0;
        _escape_html($ob, $37, $39);
      } else {
        var $41 = HEAP32[$3$s2];
        _escape_html($ob, $35, $41);
      }
      _bufput($ob, STRING_TABLE.__str665 | 0, 4);
      var $_0 = 1;
    }
  } while (0);
  var $_0;
  return $_0;
  return null;
}

_rndr_autolink["X"] = 1;

function _rndr_image($ob, $link, $title, $alt, $opaque) {
  var $1 = ($link | 0) == 0;
  do {
    if ($1) {
      var $_0 = 0;
    } else {
      var $3 = $link + 4 | 0;
      if ((HEAP32[$3 >> 2] | 0) == 0) {
        var $_0 = 0;
        break;
      }
      _bufput($ob, STRING_TABLE.__str968 | 0, 10);
      var $8 = HEAP32[$link >> 2];
      var $9 = HEAP32[$3 >> 2];
      _escape_href($ob, $8, $9);
      _bufput($ob, STRING_TABLE.__str1069 | 0, 7);
      var $10 = ($alt | 0) == 0;
      do {
        if (!$10) {
          var $13 = HEAP32[$alt + 4 >> 2];
          if (($13 | 0) == 0) {
            break;
          }
          var $17 = HEAP32[$alt >> 2];
          _escape_html($ob, $17, $13);
        }
      } while (0);
      var $19 = ($title | 0) == 0;
      do {
        if (!$19) {
          var $21 = $title + 4 | 0;
          if ((HEAP32[$21 >> 2] | 0) == 0) {
            break;
          }
          _bufput($ob, STRING_TABLE.__str463 | 0, 9);
          var $26 = HEAP32[$title >> 2];
          var $27 = HEAP32[$21 >> 2];
          _escape_html($ob, $26, $27);
        }
      } while (0);
      var $34 = (HEAP32[$opaque + 12 >> 2] & 256 | 0) != 0 ? STRING_TABLE.__str1170 | 0 : STRING_TABLE.__str564 | 0;
      _bufputs($ob, $34);
      var $_0 = 1;
    }
  } while (0);
  var $_0;
  return $_0;
  return null;
}

function _rndr_linebreak($ob, $opaque) {
  var $6 = (HEAP32[$opaque + 12 >> 2] & 256 | 0) != 0 ? STRING_TABLE.__str766 | 0 : STRING_TABLE.__str867 | 0;
  _bufputs($ob, $6);
  return 1;
  return null;
}

function _rndr_link($ob, $link, $title, $content, $opaque) {
  var __label__;
  var $1 = ($link | 0) == 0;
  do {
    if ($1) {
      _bufput($ob, STRING_TABLE.__str362 | 0, 9);
      __label__ = 10;
      break;
    }
    if ((HEAP32[$opaque + 12 >> 2] & 32 | 0) == 0) {
      _bufput($ob, STRING_TABLE.__str362 | 0, 9);
      var $_pre_phi = $link + 4 | 0;
    } else {
      var $10 = HEAP32[$link >> 2];
      var $11 = $link + 4 | 0;
      var $12 = HEAP32[$11 >> 2];
      var $13 = _sd_autolink_issafe($10, $12);
      if (($13 | 0) == 0) {
        var $_0 = 0;
        __label__ = 20;
        break;
      }
      _bufput($ob, STRING_TABLE.__str362 | 0, 9);
      var $_pre_phi = $11;
    }
    var $_pre_phi;
    var $17 = HEAP32[$_pre_phi >> 2];
    if (($17 | 0) == 0) {
      __label__ = 10;
      break;
    }
    var $21 = HEAP32[$link >> 2];
    _escape_href($ob, $21, $17);
    __label__ = 10;
    break;
  } while (0);
  if (__label__ == 10) {
    var $23 = ($title | 0) == 0;
    do {
      if (!$23) {
        var $25 = $title + 4 | 0;
        if ((HEAP32[$25 >> 2] | 0) == 0) {
          break;
        }
        _bufput($ob, STRING_TABLE.__str463 | 0, 9);
        var $30 = HEAP32[$title >> 2];
        var $31 = HEAP32[$25 >> 2];
        _escape_html($ob, $30, $31);
      }
    } while (0);
    var $34 = $opaque + 16 | 0;
    if ((HEAP32[$34 >> 2] | 0) == 0) {
      _bufput($ob, STRING_TABLE.__str564 | 0, 2);
    } else {
      _bufputc($ob, 34);
      var $38 = HEAP32[$34 >> 2];
      FUNCTION_TABLE[$38]($ob, $link, $opaque);
      _bufputc($ob, 62);
    }
    var $41 = ($content | 0) == 0;
    do {
      if (!$41) {
        var $44 = HEAP32[$content + 4 >> 2];
        if (($44 | 0) == 0) {
          break;
        }
        var $48 = HEAP32[$content >> 2];
        _bufput($ob, $48, $44);
      }
    } while (0);
    _bufput($ob, STRING_TABLE.__str665 | 0, 4);
    var $_0 = 1;
  }
  var $_0;
  return $_0;
  return null;
}

_rndr_link["X"] = 1;

function _rndr_raw_html($ob, $text, $opaque) {
  var $2$s2;
  var $text$s2 = $text >> 2;
  var $2$s2 = ($opaque + 12 | 0) >> 2;
  var $3 = HEAP32[$2$s2];
  var $5 = ($3 & 512 | 0) == 0;
  do {
    if ($5) {
      if (($3 & 1 | 0) != 0) {
        break;
      }
      if (($3 & 2 | 0) == 0) {
        var $25 = $3;
      } else {
        var $19 = HEAP32[$text$s2];
        var $21 = HEAP32[$text$s2 + 1];
        var $22 = _sdhtml_is_tag($19, $21, STRING_TABLE.__str8103 | 0);
        if (($22 | 0) != 0) {
          break;
        }
        var $25 = HEAP32[$2$s2];
      }
      var $25;
      var $_pre4_pre = $text | 0;
      if (($25 & 8 | 0) == 0) {
        var $34 = $25;
        var $_pre4_pre_phi = $_pre4_pre;
      } else {
        var $29 = HEAP32[$_pre4_pre >> 2];
        var $31 = HEAP32[$text$s2 + 1];
        var $32 = _sdhtml_is_tag($29, $31, STRING_TABLE.__str160 | 0);
        if (($32 | 0) != 0) {
          break;
        }
        var $34 = HEAP32[$2$s2];
        var $_pre4_pre_phi = $_pre4_pre;
      }
      var $_pre4_pre_phi;
      var $34;
      if (($34 & 4 | 0) == 0) {
        var $_pre_phi6 = $text + 4 | 0;
      } else {
        var $38 = HEAP32[$_pre4_pre_phi >> 2];
        var $39 = $text + 4 | 0;
        var $40 = HEAP32[$39 >> 2];
        var $41 = _sdhtml_is_tag($38, $40, STRING_TABLE.__str261 | 0);
        if (($41 | 0) != 0) {
          break;
        }
        var $_pre_phi6 = $39;
      }
      var $_pre_phi6;
      var $44 = HEAP32[$_pre4_pre_phi >> 2];
      var $45 = HEAP32[$_pre_phi6 >> 2];
      _bufput($ob, $44, $45);
    } else {
      var $8 = HEAP32[$text$s2];
      var $10 = HEAP32[$text$s2 + 1];
      _escape_html($ob, $8, $10);
    }
  } while (0);
  return 1;
  return null;
}

_rndr_raw_html["X"] = 1;

function _rndr_normal_text($ob, $text, $opaque) {
  if (($text | 0) != 0) {
    var $4 = HEAP32[$text >> 2];
    var $6 = HEAP32[$text + 4 >> 2];
    _escape_html($ob, $4, $6);
  }
  return;
  return;
}

function _escape_html($ob, $source, $length) {
  _houdini_escape_html0($ob, $source, $length, 0);
  return;
  return;
}

function _escape_href($ob, $source, $length) {
  _houdini_escape_href($ob, $source, $length);
  return;
  return;
}

function _sdhtml_smartypants($ob, $text, $size) {
  var __stackBase__ = STACKTOP;
  STACKTOP += 8;
  assert(STACKTOP % 4 == 0, "Stack is unaligned");
  assert(STACKTOP < STACK_MAX, "Ran out of stack");
  var __label__;
  var $smrt = __stackBase__;
  var $1 = $smrt;
  HEAP32[$1 >> 2] = 0;
  HEAP32[$1 + 4 >> 2] = 0;
  var $2 = ($text | 0) == 0;
  $_$155 : do {
    if (!$2) {
      var $4 = _bufgrow($ob, $size);
      if (($size | 0) == 0) {
        break;
      }
      var $i_02 = 0;
      while (1) {
        var $i_02;
        var $i_1 = $i_02;
        while (1) {
          var $i_1;
          if ($i_1 >>> 0 >= $size >>> 0) {
            var $action_11 = 0;
            var $_lcssa = 0;
            break;
          }
          var $12 = STRING_TABLE._smartypants_cb_chars + (HEAPU8[$text + $i_1 | 0] & 255) | 0;
          var $13 = HEAPU8[$12];
          if ($13 << 24 >> 24 != 0) {
            var $action_11 = $13;
            var $_lcssa = 1;
            break;
          }
          var $i_1 = $i_1 + 1 | 0;
        }
        var $_lcssa;
        var $action_11;
        if ($i_1 >>> 0 > $i_02 >>> 0) {
          var $18 = $text + $i_02 | 0;
          _bufput($ob, $18, $i_1 - $i_02 | 0);
        } else {
          __label__ = 9;
        }
        if ($_lcssa) {
          var $24 = HEAP32[_smartypants_cb_ptrs + (($action_11 & 255) << 2) >> 2];
          if (($i_1 | 0) == 0) {
            var $31 = 0;
          } else {
            var $31 = HEAP8[$text + ($i_1 - 1) | 0];
          }
          var $31;
          var $32 = $text + $i_1 | 0;
          var $33 = $size - $i_1 | 0;
          var $34 = FUNCTION_TABLE[$24]($ob, $smrt, $31, $32, $33);
          var $i_2 = $34 + $i_1 | 0;
        } else {
          var $i_2 = $i_1;
        }
        var $i_2;
        var $37 = $i_2 + 1 | 0;
        if ($37 >>> 0 >= $size >>> 0) {
          break $_$155;
        }
        var $i_02 = $37;
      }
    }
  } while (0);
  STACKTOP = __stackBase__;
  return;
  return;
}

_sdhtml_smartypants["X"] = 1;

function _smartypants_cb__dash($ob, $smrt, $previous_char, $text, $size) {
  var __label__;
  var $1 = $size >>> 0 > 2;
  do {
    if ($1) {
      if (HEAP8[$text + 1 | 0] << 24 >> 24 != 45) {
        __label__ = 6;
        break;
      }
      if (HEAP8[$text + 2 | 0] << 24 >> 24 != 45) {
        __label__ = 6;
        break;
      }
      _bufput($ob, STRING_TABLE.__str19114 | 0, 7);
      var $_0 = 2;
      __label__ = 10;
      break;
    }
    __label__ = 6;
  } while (0);
  $_$178 : do {
    if (__label__ == 6) {
      var $12 = $size >>> 0 > 1;
      do {
        if ($12) {
          if (HEAP8[$text + 1 | 0] << 24 >> 24 != 45) {
            break;
          }
          _bufput($ob, STRING_TABLE.__str20115 | 0, 7);
          var $_0 = 1;
          break $_$178;
        }
      } while (0);
      var $20 = HEAPU8[$text] & 255;
      _bufputc($ob, $20);
      var $_0 = 0;
    }
  } while (0);
  var $_0;
  return $_0;
  return null;
}

function _smartypants_cb__parens($ob, $smrt, $previous_char, $text, $size) {
  var __label__;
  var $1 = $size >>> 0 > 2;
  do {
    if ($1) {
      var $5 = HEAPU8[$text + 1 | 0] & 255;
      var $6 = _tolower($5);
      var $9 = HEAPU8[$text + 2 | 0] & 255;
      var $10 = _tolower($9);
      var $11 = $6 & 255;
      if (($11 | 0) == 99) {
        if (($10 & 255 | 0) != 41) {
          __label__ = 12;
          break;
        }
        _bufput($ob, STRING_TABLE.__str16111 | 0, 6);
        var $_0 = 2;
        __label__ = 13;
        break;
      } else if (($11 | 0) == 114) {
        if (($10 & 255 | 0) != 41) {
          __label__ = 12;
          break;
        }
        _bufput($ob, STRING_TABLE.__str17112 | 0, 5);
        var $_0 = 2;
        __label__ = 13;
        break;
      } else {
        if (!($size >>> 0 > 3 & ($11 | 0) == 116)) {
          __label__ = 12;
          break;
        }
        if (($10 & 255 | 0) != 109) {
          __label__ = 12;
          break;
        }
        if (HEAP8[$text + 3 | 0] << 24 >> 24 != 41) {
          __label__ = 12;
          break;
        }
        _bufput($ob, STRING_TABLE.__str18113 | 0, 7);
        var $_0 = 3;
        __label__ = 13;
        break;
      }
    } else {
      __label__ = 12;
    }
  } while (0);
  if (__label__ == 12) {
    var $32 = HEAPU8[$text] & 255;
    _bufputc($ob, $32);
    var $_0 = 0;
  }
  var $_0;
  return $_0;
  return null;
}

function _smartypants_cb__squote($ob, $smrt, $previous_char, $text, $size) {
  var __label__;
  var $1 = $size >>> 0 > 1;
  $_$201 : do {
    if ($1) {
      var $5 = HEAPU8[$text + 1 | 0] & 255;
      var $6 = _tolower($5);
      var $7 = $6 & 255;
      do {
        if (($7 | 0) == 39) {
          if ($size >>> 0 > 2) {
            var $14 = HEAP8[$text + 2 | 0];
          } else {
            var $14 = 0;
          }
          var $14;
          var $15 = $smrt + 4 | 0;
          var $16 = _smartypants_quotes($ob, $previous_char, $14, 100, $15);
          if (($16 | 0) != 0) {
            var $_0 = 1;
            __label__ = 22;
            break $_$201;
          }
        } else if (($7 | 0) == 115 || ($7 | 0) == 116 || ($7 | 0) == 109 || ($7 | 0) == 100) {
          if (($size | 0) != 3) {
            var $22 = HEAP8[$text + 2 | 0];
            var $23 = _word_boundary($22);
            if (($23 | 0) == 0) {
              break;
            }
          }
          _bufput($ob, STRING_TABLE.__str15110 | 0, 7);
          var $_0 = 0;
          __label__ = 22;
          break $_$201;
        }
      } while (0);
      if ($size >>> 0 <= 2) {
        __label__ = 18;
        break;
      }
      var $31 = HEAPU8[$text + 2 | 0] & 255;
      var $32 = _tolower($31);
      if (($7 | 0) == 114) {
        if (($32 & 255 | 0) != 101) {
          __label__ = 18;
          break;
        }
      } else if (($7 | 0) == 108) {
        if (($32 & 255 | 0) != 108) {
          __label__ = 18;
          break;
        }
      } else if (($7 | 0) == 118) {
        if (($32 & 255 | 0) != 101) {
          __label__ = 18;
          break;
        }
      } else {
        __label__ = 18;
        break;
      }
      if (($size | 0) != 4) {
        var $46 = HEAP8[$text + 3 | 0];
        var $47 = _word_boundary($46);
        if (($47 | 0) == 0) {
          __label__ = 18;
          break;
        }
      }
      _bufput($ob, STRING_TABLE.__str15110 | 0, 7);
      var $_0 = 0;
      __label__ = 22;
      break;
    }
    __label__ = 18;
  } while (0);
  do {
    if (__label__ == 18) {
      if (($size | 0) == 0) {
        var $55 = 0;
      } else {
        var $55 = HEAP8[$text + 1 | 0];
      }
      var $55;
      var $56 = $smrt | 0;
      var $57 = _smartypants_quotes($ob, $previous_char, $55, 115, $56);
      if (($57 | 0) != 0) {
        var $_0 = 0;
        break;
      }
      var $61 = HEAPU8[$text] & 255;
      _bufputc($ob, $61);
      var $_0 = 0;
    }
  } while (0);
  var $_0;
  return $_0;
  return null;
}

_smartypants_cb__squote["X"] = 1;

function _smartypants_cb__dquote($ob, $smrt, $previous_char, $text, $size) {
  if (($size | 0) == 0) {
    var $6 = 0;
  } else {
    var $6 = HEAP8[$text + 1 | 0];
  }
  var $6;
  var $7 = $smrt + 4 | 0;
  var $8 = _smartypants_quotes($ob, $previous_char, $6, 100, $7);
  if (($8 | 0) == 0) {
    _bufput($ob, STRING_TABLE.__str1117 | 0, 6);
  }
  return 0;
  return null;
}

function _smartypants_cb__amp($ob, $smrt, $previous_char, $text, $size) {
  var __label__;
  var $1 = $size >>> 0 > 5;
  do {
    if ($1) {
      var $3 = _memcmp($text, STRING_TABLE.__str1117 | 0, 6);
      if (($3 | 0) != 0) {
        __label__ = 7;
        break;
      }
      if ($size >>> 0 > 6) {
        var $11 = HEAP8[$text + 6 | 0];
      } else {
        var $11 = 0;
      }
      var $11;
      var $12 = $smrt + 4 | 0;
      var $13 = _smartypants_quotes($ob, $previous_char, $11, 100, $12);
      if (($13 | 0) == 0) {
        __label__ = 7;
        break;
      }
      var $_0 = 5;
      __label__ = 10;
      break;
    } else {
      __label__ = 7;
    }
  } while (0);
  do {
    if (__label__ == 7) {
      if ($size >>> 0 > 3) {
        var $18 = _memcmp($text, STRING_TABLE.__str14109 | 0, 4);
        if (($18 | 0) == 0) {
          var $_0 = 3;
          break;
        }
      }
      _bufputc($ob, 38);
      var $_0 = 0;
    }
  } while (0);
  var $_0;
  return $_0;
  return null;
}

function _smartypants_cb__period($ob, $smrt, $previous_char, $text, $size) {
  var __label__;
  var $1 = $size >>> 0 > 2;
  do {
    if ($1) {
      var $4 = HEAPU8[$text + 1 | 0];
      if ($4 << 24 >> 24 == 46) {
        if (HEAP8[$text + 2 | 0] << 24 >> 24 != 46) {
          __label__ = 11;
          break;
        }
        _bufput($ob, STRING_TABLE.__str12107 | 0, 8);
        var $_0 = 2;
        __label__ = 12;
        break;
      }
      if (!($size >>> 0 > 4 & $4 << 24 >> 24 == 32)) {
        __label__ = 11;
        break;
      }
      if (HEAP8[$text + 2 | 0] << 24 >> 24 != 46) {
        __label__ = 11;
        break;
      }
      if (HEAP8[$text + 3 | 0] << 24 >> 24 != 32) {
        __label__ = 11;
        break;
      }
      if (HEAP8[$text + 4 | 0] << 24 >> 24 != 46) {
        __label__ = 11;
        break;
      }
      _bufput($ob, STRING_TABLE.__str12107 | 0, 8);
      var $_0 = 4;
      __label__ = 12;
      break;
    } else {
      __label__ = 11;
    }
  } while (0);
  if (__label__ == 11) {
    var $28 = HEAPU8[$text] & 255;
    _bufputc($ob, $28);
    var $_0 = 0;
  }
  var $_0;
  return $_0;
  return null;
}

function _smartypants_cb__number($ob, $smrt, $previous_char, $text, $size) {
  var __label__;
  var $1 = _word_boundary($previous_char);
  var $or_cond = ($1 | 0) != 0 & $size >>> 0 > 2;
  $_$29 : do {
    if ($or_cond) {
      var $6 = HEAP8[$text] << 24 >> 24 == 49;
      $_$31 : do {
        if ($6) {
          var $8 = $text + 1 | 0;
          if (HEAP8[$8] << 24 >> 24 != 47) {
            __label__ = 19;
            break;
          }
          var $12 = $text + 2 | 0;
          var $13 = HEAPU8[$12];
          var $14 = $13 << 24 >> 24 == 50;
          $_$34 : do {
            if ($14) {
              var $16 = ($size | 0) == 3;
              do {
                if (!$16) {
                  var $19 = HEAP8[$text + 3 | 0];
                  var $20 = _word_boundary($19);
                  if (($20 | 0) != 0) {
                    break;
                  }
                  var $_pr_pre = HEAPU8[$text];
                  if ($_pr_pre << 24 >> 24 != 49) {
                    var $49 = $_pr_pre;
                    __label__ = 20;
                    break $_$31;
                  }
                  if (HEAP8[$8] << 24 >> 24 != 47) {
                    __label__ = 19;
                    break $_$31;
                  }
                  var $25 = HEAP8[$12];
                  break $_$34;
                }
              } while (0);
              _bufput($ob, STRING_TABLE.__str9104 | 0, 8);
              var $_0 = 2;
              __label__ = 31;
              break $_$29;
            }
            var $25 = $13;
          } while (0);
          var $25;
          if ($25 << 24 >> 24 != 52) {
            __label__ = 19;
            break;
          }
          var $28 = ($size | 0) == 3;
          do {
            if (!$28) {
              var $30 = $text + 3 | 0;
              var $31 = HEAP8[$30];
              var $32 = _word_boundary($31);
              if (($32 | 0) != 0) {
                break;
              }
              if ($size >>> 0 <= 4) {
                __label__ = 19;
                break $_$31;
              }
              var $38 = HEAPU8[$30] & 255;
              var $39 = _tolower($38);
              if (($39 | 0) != 116) {
                __label__ = 19;
                break $_$31;
              }
              var $44 = HEAPU8[$text + 4 | 0] & 255;
              var $45 = _tolower($44);
              if (($45 | 0) != 104) {
                __label__ = 19;
                break $_$31;
              }
            }
          } while (0);
          _bufput($ob, STRING_TABLE.__str10105 | 0, 8);
          var $_0 = 2;
          __label__ = 31;
          break $_$29;
        }
        __label__ = 19;
      } while (0);
      if (__label__ == 19) {
        var $49 = HEAP8[$text];
      }
      var $49;
      if ($49 << 24 >> 24 != 51) {
        __label__ = 30;
        break;
      }
      if (HEAP8[$text + 1 | 0] << 24 >> 24 != 47) {
        __label__ = 30;
        break;
      }
      if (HEAP8[$text + 2 | 0] << 24 >> 24 != 52) {
        __label__ = 30;
        break;
      }
      var $60 = ($size | 0) == 3;
      do {
        if (!$60) {
          var $62 = $text + 3 | 0;
          var $63 = HEAP8[$62];
          var $64 = _word_boundary($63);
          if (($64 | 0) != 0) {
            break;
          }
          if ($size >>> 0 <= 5) {
            __label__ = 30;
            break $_$29;
          }
          var $70 = HEAPU8[$62] & 255;
          var $71 = _tolower($70);
          if (($71 | 0) != 116) {
            __label__ = 30;
            break $_$29;
          }
          var $76 = HEAPU8[$text + 4 | 0] & 255;
          var $77 = _tolower($76);
          if (($77 | 0) != 104) {
            __label__ = 30;
            break $_$29;
          }
          var $82 = HEAPU8[$text + 5 | 0] & 255;
          var $83 = _tolower($82);
          if (($83 | 0) != 115) {
            __label__ = 30;
            break $_$29;
          }
        }
      } while (0);
      _bufput($ob, STRING_TABLE.__str11106 | 0, 8);
      var $_0 = 2;
      __label__ = 31;
      break;
    }
    __label__ = 30;
  } while (0);
  if (__label__ == 30) {
    var $87 = HEAPU8[$text] & 255;
    _bufputc($ob, $87);
    var $_0 = 0;
  }
  var $_0;
  return $_0;
  return null;
}

_smartypants_cb__number["X"] = 1;

function _smartypants_cb__ltag($ob, $smrt, $previous_char, $text, $size) {
  var __label__;
  var $i_0 = 0;
  while (1) {
    var $i_0;
    if ($i_0 >>> 0 >= $size >>> 0) {
      var $tag_0 = 0;
      break;
    }
    if (HEAP8[$text + $i_0 | 0] << 24 >> 24 == 62) {
      var $tag_0 = 0;
      break;
    }
    var $i_0 = $i_0 + 1 | 0;
  }
  while (1) {
    var $tag_0;
    if ($tag_0 >>> 0 >= 8) {
      var $i_3 = $i_0;
      __label__ = 14;
      break;
    }
    var $11 = HEAPU32[_smartypants_cb__ltag_skip_tags + ($tag_0 << 2) >> 2];
    var $12 = _sdhtml_is_tag($text, $size, $11);
    if (($12 | 0) == 1) {
      var $i_1 = $i_0;
      __label__ = 7;
      break;
    }
    var $tag_0 = $tag_0 + 1 | 0;
  }
  $_$73 : do {
    if (__label__ == 7) {
      while (1) {
        var $i_1;
        var $15 = $i_1 >>> 0 < $size >>> 0;
        do {
          if ($15) {
            if (HEAP8[$text + $i_1 | 0] << 24 >> 24 == 60) {
              __label__ = 10;
              break;
            }
            __label__ = 9;
            break;
          } else {
            __label__ = 10;
          }
        } while (0);
        if (__label__ == 10) {
          if (($i_1 | 0) == ($size | 0)) {
            var $i_2 = $i_1;
            break;
          }
          var $22 = $text + $i_1 | 0;
          var $23 = $size - $i_1 | 0;
          var $24 = _sdhtml_is_tag($22, $23, $11);
          if (($24 | 0) == 2) {
            var $i_2 = $i_1;
            break;
          }
        }
        var $i_1 = $i_1 + 1 | 0;
      }
      while (1) {
        var $i_2;
        if ($i_2 >>> 0 >= $size >>> 0) {
          var $i_3 = $i_2;
          break $_$73;
        }
        if (HEAP8[$text + $i_2 | 0] << 24 >> 24 == 62) {
          var $i_3 = $i_2;
          break $_$73;
        }
        var $i_2 = $i_2 + 1 | 0;
      }
    }
  } while (0);
  var $i_3;
  _bufput($ob, $text, $i_3 + 1 | 0);
  return $i_3;
  return null;
}

function _smartypants_cb__backtick($ob, $smrt, $previous_char, $text, $size) {
  var __label__;
  var $1 = $size >>> 0 > 1;
  do {
    if ($1) {
      if (HEAP8[$text + 1 | 0] << 24 >> 24 != 96) {
        __label__ = 7;
        break;
      }
      if ($size >>> 0 > 2) {
        var $12 = HEAP8[$text + 2 | 0];
      } else {
        var $12 = 0;
      }
      var $12;
      var $13 = $smrt + 4 | 0;
      var $14 = _smartypants_quotes($ob, $previous_char, $12, 100, $13);
      if (($14 | 0) == 0) {
        __label__ = 7;
        break;
      }
      var $_0 = 1;
      __label__ = 8;
      break;
    } else {
      __label__ = 7;
    }
  } while (0);
  if (__label__ == 7) {
    var $_0 = 0;
  }
  var $_0;
  return $_0;
  return null;
}

function _smartypants_cb__escape($ob, $smrt, $previous_char, $text, $size) {
  if ($size >>> 0 < 2) {
    var $_0 = 0;
  } else {
    var $5 = HEAPU8[$text + 1 | 0] & 255;
    if (($5 | 0) == 92 || ($5 | 0) == 34 || ($5 | 0) == 39 || ($5 | 0) == 46 || ($5 | 0) == 45 || ($5 | 0) == 96) {
      _bufputc($ob, $5);
      var $_0 = 1;
    } else {
      _bufputc($ob, 92);
      var $_0 = 0;
    }
  }
  var $_0;
  return $_0;
  return null;
}

function _smartypants_quotes($ob, $previous_char, $next_char, $quote, $is_open) {
  var $is_open$s2 = $is_open >> 2;
  var __stackBase__ = STACKTOP;
  STACKTOP += 8;
  assert(STACKTOP % 4 == 0, "Stack is unaligned");
  assert(STACKTOP < STACK_MAX, "Ran out of stack");
  var __label__;
  var $ent = __stackBase__;
  var $2 = (HEAP32[$is_open$s2] | 0) == 0;
  do {
    if ($2) {
      __label__ = 5;
    } else {
      var $4 = _word_boundary($next_char);
      if (($4 | 0) == 0) {
        var $_0 = 0;
        __label__ = 8;
        break;
      }
      var $_pr = HEAP32[$is_open$s2];
      if (($_pr | 0) == 0) {
        __label__ = 5;
        break;
      }
      var $11 = $_pr;
      __label__ = 7;
      break;
    }
  } while (0);
  do {
    if (__label__ == 5) {
      var $8 = _word_boundary($previous_char);
      if (($8 | 0) == 0) {
        var $_0 = 0;
        __label__ = 8;
        break;
      }
      var $11 = HEAP32[$is_open$s2];
      __label__ = 7;
      break;
    }
  } while (0);
  if (__label__ == 7) {
    var $11;
    var $12 = $ent | 0;
    var $14 = ($11 | 0) != 0 ? 114 : 108;
    var $15 = $quote & 255;
    var $16 = _snprintf($12, 8, STRING_TABLE.__str95 | 0, (tempInt = STACKTOP, STACKTOP += 8, assert(STACKTOP < STACK_ROOT + STACK_MAX, "Ran out of stack"), HEAP32[tempInt >> 2] = $14, HEAP32[tempInt + 4 >> 2] = $15, tempInt));
    var $19 = (HEAP32[$is_open$s2] | 0) == 0 & 1;
    HEAP32[$is_open$s2] = $19;
    _bufputs($ob, $12);
    var $_0 = 1;
  }
  var $_0;
  STACKTOP = __stackBase__;
  return $_0;
  return null;
}

function _word_boundary($c) {
  var $1 = $c & 255;
  var $2 = $c << 24 >> 24 == 0;
  do {
    if ($2) {
      var $10 = 1;
    } else {
      var $4 = _isspace($1);
      if (($4 | 0) != 0) {
        var $10 = 1;
        break;
      }
      var $7 = _ispunct($1);
      var $10 = ($7 | 0) != 0;
    }
  } while (0);
  var $10;
  return $10 & 1;
  return null;
}

function _houdini_escape_html0($ob, $src, $size, $secure) {
  var __label__;
  var $1 = $size * 12 | 0;
  var $2 = Math.floor(($1 >>> 0) / 10);
  var $3 = _bufgrow($ob, $2);
  var $4 = ($secure | 0) == 0;
  $_$119 : do {
    if ($4) {
      var $esc_0_us = 0;
      var $i_0_us = 0;
      while (1) {
        var $i_0_us;
        var $esc_0_us;
        if ($i_0_us >>> 0 >= $size >>> 0) {
          break $_$119;
        }
        var $esc_1_us = $esc_0_us;
        var $i_1_us = $i_0_us;
        while (1) {
          var $i_1_us;
          var $esc_1_us;
          if ($i_1_us >>> 0 >= $size >>> 0) {
            var $esc_21_us = $esc_1_us;
            var $_lcssa = 0;
            break;
          }
          var $19 = STRING_TABLE._HTML_ESCAPE_TABLE + (HEAPU8[$src + $i_1_us | 0] & 255) | 0;
          var $20 = HEAPU8[$19];
          var $21 = $20 << 24 >> 24;
          if ($20 << 24 >> 24 != 0) {
            var $esc_21_us = $21;
            var $_lcssa = 1;
            break;
          }
          var $esc_1_us = $21;
          var $i_1_us = $i_1_us + 1 | 0;
        }
        var $_lcssa;
        var $esc_21_us;
        if ($i_1_us >>> 0 > $i_0_us >>> 0) {
          var $26 = $src + $i_0_us | 0;
          _bufput($ob, $26, $i_1_us - $i_0_us | 0);
        } else {
          __label__ = 7;
        }
        if (!$_lcssa) {
          break $_$119;
        }
        if (HEAP8[$src + $i_1_us | 0] << 24 >> 24 == 47) {
          _bufputc($ob, 47);
        } else {
          var $30 = HEAP32[_HTML_ESCAPES + ($esc_21_us << 2) >> 2];
          _bufputs($ob, $30);
        }
        var $esc_0_us = $esc_21_us;
        var $i_0_us = $i_1_us + 1 | 0;
      }
    } else {
      var $esc_0 = 0;
      var $i_0 = 0;
      while (1) {
        var $i_0;
        var $esc_0;
        if ($i_0 >>> 0 >= $size >>> 0) {
          break $_$119;
        }
        var $esc_1 = $esc_0;
        var $i_1 = $i_0;
        while (1) {
          var $i_1;
          var $esc_1;
          if ($i_1 >>> 0 >= $size >>> 0) {
            var $esc_21 = $esc_1;
            var $_lcssa2 = 0;
            break;
          }
          var $37 = STRING_TABLE._HTML_ESCAPE_TABLE + (HEAPU8[$src + $i_1 | 0] & 255) | 0;
          var $38 = HEAPU8[$37];
          var $39 = $38 << 24 >> 24;
          if ($38 << 24 >> 24 != 0) {
            var $esc_21 = $39;
            var $_lcssa2 = 1;
            break;
          }
          var $esc_1 = $39;
          var $i_1 = $i_1 + 1 | 0;
        }
        var $_lcssa2;
        var $esc_21;
        if ($i_1 >>> 0 > $i_0 >>> 0) {
          var $44 = $src + $i_0 | 0;
          _bufput($ob, $44, $i_1 - $i_0 | 0);
        } else {
          __label__ = 18;
        }
        if (!$_lcssa2) {
          break $_$119;
        }
        var $49 = HEAP32[_HTML_ESCAPES + ($esc_21 << 2) >> 2];
        _bufputs($ob, $49);
        var $esc_0 = $esc_21;
        var $i_0 = $i_1 + 1 | 0;
      }
    }
  } while (0);
  return;
  return;
}

_houdini_escape_html0["X"] = 1;

function _houdini_escape_html($ob, $src, $size) {
  _houdini_escape_html0($ob, $src, $size, 1);
  return;
  return;
}

function _houdini_escape_href($ob, $src, $size) {
  var __stackBase__ = STACKTOP;
  STACKTOP += 4;
  assert(STACKTOP % 4 == 0, "Stack is unaligned");
  assert(STACKTOP < STACK_MAX, "Ran out of stack");
  var __label__;
  var $hex_str = __stackBase__;
  var $1 = $size * 12 | 0;
  var $2 = Math.floor(($1 >>> 0) / 10);
  var $3 = _bufgrow($ob, $2);
  var $4 = $hex_str | 0;
  HEAP8[$4] = 37;
  var $5 = $hex_str + 1 | 0;
  var $6 = $hex_str + 2 | 0;
  var $i_0 = 0;
  while (1) {
    var $i_0;
    if ($i_0 >>> 0 >= $size >>> 0) {
      break;
    }
    var $i_1 = $i_0;
    while (1) {
      var $i_1;
      if ($i_1 >>> 0 >= $size >>> 0) {
        var $_lcssa = 0;
        break;
      }
      var $14 = STRING_TABLE._HREF_SAFE + (HEAPU8[$src + $i_1 | 0] & 255) | 0;
      if (HEAP8[$14] << 24 >> 24 == 0) {
        var $_lcssa = 1;
        break;
      }
      var $i_1 = $i_1 + 1 | 0;
    }
    var $_lcssa;
    if ($i_1 >>> 0 > $i_0 >>> 0) {
      var $20 = $src + $i_0 | 0;
      _bufput($ob, $20, $i_1 - $i_0 | 0);
    } else {
      __label__ = 8;
    }
    if (!$_lcssa) {
      break;
    }
    var $26 = HEAPU8[$src + $i_1 | 0] & 255;
    if (($26 | 0) == 38) {
      _bufput($ob, STRING_TABLE.__str125 | 0, 5);
    } else if (($26 | 0) == 39) {
      _bufput($ob, STRING_TABLE.__str1126 | 0, 6);
    } else {
      var $31 = STRING_TABLE._houdini_escape_href_hex_chars + ($26 >>> 4) | 0;
      var $32 = HEAP8[$31];
      HEAP8[$5] = $32;
      var $34 = STRING_TABLE._houdini_escape_href_hex_chars + ($26 & 15) | 0;
      var $35 = HEAP8[$34];
      HEAP8[$6] = $35;
      _bufput($ob, $4, 3);
    }
    var $i_0 = $i_1 + 1 | 0;
  }
  STACKTOP = __stackBase__;
  return;
  return;
}

_houdini_escape_href["X"] = 1;

function _malloc($bytes) {
  var __label__;
  var $1 = $bytes >>> 0 < 245;
  do {
    if ($1) {
      if ($bytes >>> 0 < 11) {
        var $8 = 16;
      } else {
        var $8 = $bytes + 11 & -8;
      }
      var $8;
      var $9 = $8 >>> 3;
      var $10 = HEAPU32[__gm_ >> 2];
      var $11 = $10 >>> ($9 >>> 0);
      if (($11 & 3 | 0) != 0) {
        var $17 = ($11 & 1 ^ 1) + $9 | 0;
        var $18 = $17 << 1;
        var $20 = ($18 << 2) + __gm_ + 40 | 0;
        var $21 = ($18 + 2 << 2) + __gm_ + 40 | 0;
        var $22 = HEAPU32[$21 >> 2];
        var $23 = $22 + 8 | 0;
        var $24 = HEAPU32[$23 >> 2];
        if (($20 | 0) == ($24 | 0)) {
          HEAP32[__gm_ >> 2] = $10 & (1 << $17 ^ -1);
        } else {
          if ($24 >>> 0 < HEAPU32[__gm_ + 16 >> 2] >>> 0) {
            _abort();
            throw "Reached an unreachable!";
          } else {
            HEAP32[$21 >> 2] = $24;
            HEAP32[$24 + 12 >> 2] = $20;
          }
        }
        var $38 = $17 << 3;
        HEAP32[$22 + 4 >> 2] = $38 | 3;
        var $43 = $22 + ($38 | 4) | 0;
        var $45 = HEAP32[$43 >> 2] | 1;
        HEAP32[$43 >> 2] = $45;
        var $mem_0 = $23;
        __label__ = 39;
        break;
      }
      if ($8 >>> 0 <= HEAPU32[__gm_ + 8 >> 2] >>> 0) {
        var $nb_0 = $8;
        __label__ = 31;
        break;
      }
      if (($11 | 0) != 0) {
        var $54 = 2 << $9;
        var $57 = $11 << $9 & ($54 | -$54);
        var $60 = ($57 & -$57) - 1 | 0;
        var $62 = $60 >>> 12 & 16;
        var $63 = $60 >>> ($62 >>> 0);
        var $65 = $63 >>> 5 & 8;
        var $66 = $63 >>> ($65 >>> 0);
        var $68 = $66 >>> 2 & 4;
        var $69 = $66 >>> ($68 >>> 0);
        var $71 = $69 >>> 1 & 2;
        var $72 = $69 >>> ($71 >>> 0);
        var $74 = $72 >>> 1 & 1;
        var $80 = ($65 | $62 | $68 | $71 | $74) + ($72 >>> ($74 >>> 0)) | 0;
        var $81 = $80 << 1;
        var $83 = ($81 << 2) + __gm_ + 40 | 0;
        var $84 = ($81 + 2 << 2) + __gm_ + 40 | 0;
        var $85 = HEAPU32[$84 >> 2];
        var $86 = $85 + 8 | 0;
        var $87 = HEAPU32[$86 >> 2];
        if (($83 | 0) == ($87 | 0)) {
          HEAP32[__gm_ >> 2] = $10 & (1 << $80 ^ -1);
        } else {
          if ($87 >>> 0 < HEAPU32[__gm_ + 16 >> 2] >>> 0) {
            _abort();
            throw "Reached an unreachable!";
          } else {
            HEAP32[$84 >> 2] = $87;
            HEAP32[$87 + 12 >> 2] = $83;
          }
        }
        var $101 = $80 << 3;
        var $102 = $101 - $8 | 0;
        HEAP32[$85 + 4 >> 2] = $8 | 3;
        var $105 = $85;
        var $107 = $105 + $8 | 0;
        HEAP32[$105 + ($8 | 4) >> 2] = $102 | 1;
        HEAP32[$105 + $101 >> 2] = $102;
        var $113 = HEAPU32[__gm_ + 8 >> 2];
        if (($113 | 0) != 0) {
          var $116 = HEAP32[__gm_ + 20 >> 2];
          var $119 = $113 >>> 2 & 1073741822;
          var $121 = ($119 << 2) + __gm_ + 40 | 0;
          var $122 = HEAPU32[__gm_ >> 2];
          var $123 = 1 << ($113 >>> 3);
          var $125 = ($122 & $123 | 0) == 0;
          do {
            if ($125) {
              HEAP32[__gm_ >> 2] = $122 | $123;
              var $F4_0 = $121;
              var $_pre_phi = ($119 + 2 << 2) + __gm_ + 40 | 0;
            } else {
              var $129 = ($119 + 2 << 2) + __gm_ + 40 | 0;
              var $130 = HEAPU32[$129 >> 2];
              if ($130 >>> 0 >= HEAPU32[__gm_ + 16 >> 2] >>> 0) {
                var $F4_0 = $130;
                var $_pre_phi = $129;
                break;
              }
              _abort();
              throw "Reached an unreachable!";
            }
          } while (0);
          var $_pre_phi;
          var $F4_0;
          HEAP32[$_pre_phi >> 2] = $116;
          HEAP32[$F4_0 + 12 >> 2] = $116;
          var $137 = $116 + 8 | 0;
          HEAP32[$137 >> 2] = $F4_0;
          var $138 = $116 + 12 | 0;
          HEAP32[$138 >> 2] = $121;
        }
        HEAP32[__gm_ + 8 >> 2] = $102;
        HEAP32[__gm_ + 20 >> 2] = $107;
        var $mem_0 = $86;
        __label__ = 39;
        break;
      }
      if ((HEAP32[__gm_ + 4 >> 2] | 0) == 0) {
        var $nb_0 = $8;
        __label__ = 31;
        break;
      }
      var $145 = _tmalloc_small($8);
      if (($145 | 0) == 0) {
        var $nb_0 = $8;
        __label__ = 31;
        break;
      }
      var $mem_0 = $145;
      __label__ = 39;
      break;
    } else {
      if ($bytes >>> 0 > 4294967231) {
        var $nb_0 = -1;
        __label__ = 31;
        break;
      }
      var $151 = $bytes + 11 & -8;
      if ((HEAP32[__gm_ + 4 >> 2] | 0) == 0) {
        var $nb_0 = $151;
        __label__ = 31;
        break;
      }
      var $155 = _tmalloc_large($151);
      if (($155 | 0) == 0) {
        var $nb_0 = $151;
        __label__ = 31;
        break;
      }
      var $mem_0 = $155;
      __label__ = 39;
      break;
    }
  } while (0);
  if (__label__ == 31) {
    var $nb_0;
    var $157 = HEAPU32[__gm_ + 8 >> 2];
    if ($nb_0 >>> 0 > $157 >>> 0) {
      var $186 = HEAPU32[__gm_ + 12 >> 2];
      if ($nb_0 >>> 0 < $186 >>> 0) {
        var $189 = $186 - $nb_0 | 0;
        HEAP32[__gm_ + 12 >> 2] = $189;
        var $190 = HEAPU32[__gm_ + 24 >> 2];
        var $191 = $190;
        HEAP32[__gm_ + 24 >> 2] = $191 + $nb_0 | 0;
        HEAP32[$nb_0 + ($191 + 4) >> 2] = $189 | 1;
        HEAP32[$190 + 4 >> 2] = $nb_0 | 3;
        var $mem_0 = $190 + 8 | 0;
      } else {
        var $202 = _sys_alloc($nb_0);
        var $mem_0 = $202;
      }
    } else {
      var $160 = $157 - $nb_0 | 0;
      var $161 = HEAPU32[__gm_ + 20 >> 2];
      if ($160 >>> 0 > 15) {
        var $164 = $161;
        HEAP32[__gm_ + 20 >> 2] = $164 + $nb_0 | 0;
        HEAP32[__gm_ + 8 >> 2] = $160;
        HEAP32[$nb_0 + ($164 + 4) >> 2] = $160 | 1;
        HEAP32[$164 + $157 >> 2] = $160;
        HEAP32[$161 + 4 >> 2] = $nb_0 | 3;
      } else {
        HEAP32[__gm_ + 8 >> 2] = 0;
        HEAP32[__gm_ + 20 >> 2] = 0;
        HEAP32[$161 + 4 >> 2] = $157 | 3;
        var $179 = $157 + ($161 + 4) | 0;
        var $181 = HEAP32[$179 >> 2] | 1;
        HEAP32[$179 >> 2] = $181;
      }
      var $mem_0 = $161 + 8 | 0;
    }
  }
  var $mem_0;
  return $mem_0;
  return null;
}

Module["_malloc"] = _malloc;

_malloc["X"] = 1;

function _tmalloc_small($nb) {
  var $R_1$s2;
  var $v_0$s2;
  var __label__;
  var $1 = HEAP32[__gm_ + 4 >> 2];
  var $4 = ($1 & -$1) - 1 | 0;
  var $6 = $4 >>> 12 & 16;
  var $7 = $4 >>> ($6 >>> 0);
  var $9 = $7 >>> 5 & 8;
  var $10 = $7 >>> ($9 >>> 0);
  var $12 = $10 >>> 2 & 4;
  var $13 = $10 >>> ($12 >>> 0);
  var $15 = $13 >>> 1 & 2;
  var $16 = $13 >>> ($15 >>> 0);
  var $18 = $16 >>> 1 & 1;
  var $26 = HEAPU32[__gm_ + (($9 | $6 | $12 | $15 | $18) + ($16 >>> ($18 >>> 0)) << 2) + 304 >> 2];
  var $t_0 = $26;
  var $v_0 = $26, $v_0$s2 = $v_0 >> 2;
  var $rsize_0 = (HEAP32[$26 + 4 >> 2] & -8) - $nb | 0;
  while (1) {
    var $rsize_0;
    var $v_0;
    var $t_0;
    var $33 = HEAP32[$t_0 + 16 >> 2];
    if (($33 | 0) == 0) {
      var $37 = HEAP32[$t_0 + 20 >> 2];
      if (($37 | 0) == 0) {
        break;
      }
      var $39 = $37;
    } else {
      var $39 = $33;
    }
    var $39;
    var $43 = (HEAP32[$39 + 4 >> 2] & -8) - $nb | 0;
    var $44 = $43 >>> 0 < $rsize_0 >>> 0;
    var $_rsize_0 = $44 ? $43 : $rsize_0;
    var $_v_0 = $44 ? $39 : $v_0;
    var $t_0 = $39;
    var $v_0 = $_v_0, $v_0$s2 = $v_0 >> 2;
    var $rsize_0 = $_rsize_0;
  }
  var $46 = $v_0;
  var $47 = HEAPU32[__gm_ + 16 >> 2];
  var $48 = $46 >>> 0 < $47 >>> 0;
  do {
    if (!$48) {
      var $50 = $46 + $nb | 0;
      var $51 = $50;
      if ($46 >>> 0 >= $50 >>> 0) {
        break;
      }
      var $55 = HEAPU32[$v_0$s2 + 6];
      var $57 = HEAPU32[$v_0$s2 + 3];
      var $58 = ($57 | 0) == ($v_0 | 0);
      do {
        if ($58) {
          var $69 = $v_0 + 20 | 0;
          var $70 = HEAP32[$69 >> 2];
          if (($70 | 0) == 0) {
            var $73 = $v_0 + 16 | 0;
            var $74 = HEAP32[$73 >> 2];
            if (($74 | 0) == 0) {
              var $R_1 = 0, $R_1$s2 = $R_1 >> 2;
              break;
            }
            var $RP_0 = $73;
            var $R_0 = $74;
          } else {
            var $RP_0 = $69;
            var $R_0 = $70;
            __label__ = 14;
          }
          while (1) {
            var $R_0;
            var $RP_0;
            var $76 = $R_0 + 20 | 0;
            var $77 = HEAP32[$76 >> 2];
            if (($77 | 0) != 0) {
              var $RP_0 = $76;
              var $R_0 = $77;
              continue;
            }
            var $80 = $R_0 + 16 | 0;
            var $81 = HEAPU32[$80 >> 2];
            if (($81 | 0) == 0) {
              break;
            }
            var $RP_0 = $80;
            var $R_0 = $81;
          }
          if ($RP_0 >>> 0 < $47 >>> 0) {
            _abort();
            throw "Reached an unreachable!";
          } else {
            HEAP32[$RP_0 >> 2] = 0;
            var $R_1 = $R_0, $R_1$s2 = $R_1 >> 2;
          }
        } else {
          var $61 = HEAPU32[$v_0$s2 + 2];
          if ($61 >>> 0 < $47 >>> 0) {
            _abort();
            throw "Reached an unreachable!";
          } else {
            HEAP32[$61 + 12 >> 2] = $57;
            HEAP32[$57 + 8 >> 2] = $61;
            var $R_1 = $57, $R_1$s2 = $R_1 >> 2;
          }
        }
      } while (0);
      var $R_1;
      var $89 = ($55 | 0) == 0;
      $_$27 : do {
        if (!$89) {
          var $91 = $v_0 + 28 | 0;
          var $93 = (HEAP32[$91 >> 2] << 2) + __gm_ + 304 | 0;
          var $95 = ($v_0 | 0) == (HEAP32[$93 >> 2] | 0);
          do {
            if ($95) {
              HEAP32[$93 >> 2] = $R_1;
              if (($R_1 | 0) != 0) {
                break;
              }
              var $101 = HEAP32[__gm_ + 4 >> 2] & (1 << HEAP32[$91 >> 2] ^ -1);
              HEAP32[__gm_ + 4 >> 2] = $101;
              break $_$27;
            }
            if ($55 >>> 0 < HEAPU32[__gm_ + 16 >> 2] >>> 0) {
              _abort();
              throw "Reached an unreachable!";
            } else {
              var $107 = $55 + 16 | 0;
              if ((HEAP32[$107 >> 2] | 0) == ($v_0 | 0)) {
                HEAP32[$107 >> 2] = $R_1;
              } else {
                HEAP32[$55 + 20 >> 2] = $R_1;
              }
              if (($R_1 | 0) == 0) {
                break $_$27;
              }
            }
          } while (0);
          if ($R_1 >>> 0 < HEAPU32[__gm_ + 16 >> 2] >>> 0) {
            _abort();
            throw "Reached an unreachable!";
          } else {
            HEAP32[$R_1$s2 + 6] = $55;
            var $123 = HEAPU32[$v_0$s2 + 4];
            if (($123 | 0) != 0) {
              if ($123 >>> 0 < HEAPU32[__gm_ + 16 >> 2] >>> 0) {
                _abort();
                throw "Reached an unreachable!";
              } else {
                HEAP32[$R_1$s2 + 4] = $123;
                HEAP32[$123 + 24 >> 2] = $R_1;
              }
            }
            var $135 = HEAPU32[$v_0$s2 + 5];
            if (($135 | 0) == 0) {
              break;
            }
            if ($135 >>> 0 < HEAPU32[__gm_ + 16 >> 2] >>> 0) {
              _abort();
              throw "Reached an unreachable!";
            } else {
              HEAP32[$R_1$s2 + 5] = $135;
              HEAP32[$135 + 24 >> 2] = $R_1;
            }
          }
        }
      } while (0);
      if ($rsize_0 >>> 0 < 16) {
        var $149 = $rsize_0 + $nb | 0;
        HEAP32[$v_0$s2 + 1] = $149 | 3;
        var $153 = $149 + ($46 + 4) | 0;
        var $155 = HEAP32[$153 >> 2] | 1;
        HEAP32[$153 >> 2] = $155;
      } else {
        HEAP32[$v_0$s2 + 1] = $nb | 3;
        HEAP32[$nb + ($46 + 4) >> 2] = $rsize_0 | 1;
        HEAP32[$46 + $rsize_0 + $nb >> 2] = $rsize_0;
        var $164 = HEAPU32[__gm_ + 8 >> 2];
        if (($164 | 0) != 0) {
          var $167 = HEAPU32[__gm_ + 20 >> 2];
          var $170 = $164 >>> 2 & 1073741822;
          var $172 = ($170 << 2) + __gm_ + 40 | 0;
          var $173 = HEAPU32[__gm_ >> 2];
          var $174 = 1 << ($164 >>> 3);
          var $176 = ($173 & $174 | 0) == 0;
          do {
            if ($176) {
              HEAP32[__gm_ >> 2] = $173 | $174;
              var $F1_0 = $172;
              var $_pre_phi = ($170 + 2 << 2) + __gm_ + 40 | 0;
            } else {
              var $180 = ($170 + 2 << 2) + __gm_ + 40 | 0;
              var $181 = HEAPU32[$180 >> 2];
              if ($181 >>> 0 >= HEAPU32[__gm_ + 16 >> 2] >>> 0) {
                var $F1_0 = $181;
                var $_pre_phi = $180;
                break;
              }
              _abort();
              throw "Reached an unreachable!";
            }
          } while (0);
          var $_pre_phi;
          var $F1_0;
          HEAP32[$_pre_phi >> 2] = $167;
          HEAP32[$F1_0 + 12 >> 2] = $167;
          HEAP32[$167 + 8 >> 2] = $F1_0;
          HEAP32[$167 + 12 >> 2] = $172;
        }
        HEAP32[__gm_ + 8 >> 2] = $rsize_0;
        HEAP32[__gm_ + 20 >> 2] = $51;
      }
      return $v_0 + 8 | 0;
    }
  } while (0);
  _abort();
  throw "Reached an unreachable!";
  return null;
}

_tmalloc_small["X"] = 1;

function _tmalloc_large($nb) {
  var $R_1$s2;
  var $112$s2;
  var $t_224$s2;
  var $v_3_lcssa$s2;
  var $t_0$s2;
  var $nb$s2 = $nb >> 2;
  var __label__;
  var $1 = -$nb | 0;
  var $2 = $nb >>> 8;
  var $3 = ($2 | 0) == 0;
  do {
    if ($3) {
      var $idx_0 = 0;
    } else {
      if ($nb >>> 0 > 16777215) {
        var $idx_0 = 31;
        break;
      }
      var $9 = ($2 + 1048320 | 0) >>> 16 & 8;
      var $10 = $2 << $9;
      var $13 = ($10 + 520192 | 0) >>> 16 & 4;
      var $14 = $10 << $13;
      var $17 = ($14 + 245760 | 0) >>> 16 & 2;
      var $23 = 14 - ($13 | $9 | $17) + ($14 << $17 >>> 15) | 0;
      var $idx_0 = $nb >>> (($23 + 7 | 0) >>> 0) & 1 | $23 << 1;
    }
  } while (0);
  var $idx_0;
  var $31 = HEAPU32[__gm_ + ($idx_0 << 2) + 304 >> 2];
  var $32 = ($31 | 0) == 0;
  $_$73 : do {
    if ($32) {
      var $v_2 = 0;
      var $rsize_2 = $1;
      var $t_1 = 0;
    } else {
      if (($idx_0 | 0) == 31) {
        var $39 = 0;
      } else {
        var $39 = 25 - ($idx_0 >>> 1) | 0;
      }
      var $39;
      var $v_0 = 0;
      var $rsize_0 = $1;
      var $t_0 = $31, $t_0$s2 = $t_0 >> 2;
      var $sizebits_0 = $nb << $39;
      var $rst_0 = 0;
      while (1) {
        var $rst_0;
        var $sizebits_0;
        var $t_0;
        var $rsize_0;
        var $v_0;
        var $44 = HEAP32[$t_0$s2 + 1] & -8;
        var $45 = $44 - $nb | 0;
        if ($45 >>> 0 < $rsize_0 >>> 0) {
          if (($44 | 0) == ($nb | 0)) {
            var $v_2 = $t_0;
            var $rsize_2 = $45;
            var $t_1 = $t_0;
            break $_$73;
          }
          var $v_1 = $t_0;
          var $rsize_1 = $45;
        } else {
          var $v_1 = $v_0;
          var $rsize_1 = $rsize_0;
        }
        var $rsize_1;
        var $v_1;
        var $51 = HEAPU32[$t_0$s2 + 5];
        var $54 = HEAPU32[(($sizebits_0 >>> 31 << 2) + 16 >> 2) + $t_0$s2];
        var $rst_1 = ($51 | 0) == 0 | ($51 | 0) == ($54 | 0) ? $rst_0 : $51;
        if (($54 | 0) == 0) {
          var $v_2 = $v_1;
          var $rsize_2 = $rsize_1;
          var $t_1 = $rst_1;
          break $_$73;
        }
        var $v_0 = $v_1;
        var $rsize_0 = $rsize_1;
        var $t_0 = $54, $t_0$s2 = $t_0 >> 2;
        var $sizebits_0 = $sizebits_0 << 1;
        var $rst_0 = $rst_1;
      }
    }
  } while (0);
  var $t_1;
  var $rsize_2;
  var $v_2;
  var $or_cond19 = ($t_1 | 0) == 0 & ($v_2 | 0) == 0;
  do {
    if ($or_cond19) {
      var $62 = 2 << $idx_0;
      var $66 = HEAP32[__gm_ + 4 >> 2] & ($62 | -$62);
      if (($66 | 0) == 0) {
        var $_0 = 0;
        __label__ = 80;
        break;
      }
      var $71 = ($66 & -$66) - 1 | 0;
      var $73 = $71 >>> 12 & 16;
      var $74 = $71 >>> ($73 >>> 0);
      var $76 = $74 >>> 5 & 8;
      var $77 = $74 >>> ($76 >>> 0);
      var $79 = $77 >>> 2 & 4;
      var $80 = $77 >>> ($79 >>> 0);
      var $82 = $80 >>> 1 & 2;
      var $83 = $80 >>> ($82 >>> 0);
      var $85 = $83 >>> 1 & 1;
      var $t_2_ph = HEAP32[__gm_ + (($76 | $73 | $79 | $82 | $85) + ($83 >>> ($85 >>> 0)) << 2) + 304 >> 2];
      __label__ = 15;
      break;
    }
    var $t_2_ph = $t_1;
    __label__ = 15;
  } while (0);
  $_$87 : do {
    if (__label__ == 15) {
      var $t_2_ph;
      var $94 = ($t_2_ph | 0) == 0;
      $_$89 : do {
        if ($94) {
          var $rsize_3_lcssa = $rsize_2;
          var $v_3_lcssa = $v_2, $v_3_lcssa$s2 = $v_3_lcssa >> 2;
        } else {
          var $t_224 = $t_2_ph, $t_224$s2 = $t_224 >> 2;
          var $rsize_325 = $rsize_2;
          var $v_326 = $v_2;
          while (1) {
            var $v_326;
            var $rsize_325;
            var $t_224;
            var $98 = (HEAP32[$t_224$s2 + 1] & -8) - $nb | 0;
            var $99 = $98 >>> 0 < $rsize_325 >>> 0;
            var $_rsize_3 = $99 ? $98 : $rsize_325;
            var $t_2_v_3 = $99 ? $t_224 : $v_326;
            var $101 = HEAPU32[$t_224$s2 + 4];
            if (($101 | 0) != 0) {
              var $t_224 = $101, $t_224$s2 = $t_224 >> 2;
              var $rsize_325 = $_rsize_3;
              var $v_326 = $t_2_v_3;
              continue;
            }
            var $104 = HEAPU32[$t_224$s2 + 5];
            if (($104 | 0) == 0) {
              var $rsize_3_lcssa = $_rsize_3;
              var $v_3_lcssa = $t_2_v_3, $v_3_lcssa$s2 = $v_3_lcssa >> 2;
              break $_$89;
            }
            var $t_224 = $104, $t_224$s2 = $t_224 >> 2;
            var $rsize_325 = $_rsize_3;
            var $v_326 = $t_2_v_3;
          }
        }
      } while (0);
      var $v_3_lcssa;
      var $rsize_3_lcssa;
      if (($v_3_lcssa | 0) == 0) {
        var $_0 = 0;
        break;
      }
      if ($rsize_3_lcssa >>> 0 >= (HEAP32[__gm_ + 8 >> 2] - $nb | 0) >>> 0) {
        var $_0 = 0;
        break;
      }
      var $112 = $v_3_lcssa, $112$s2 = $112 >> 2;
      var $113 = HEAPU32[__gm_ + 16 >> 2];
      var $114 = $112 >>> 0 < $113 >>> 0;
      do {
        if (!$114) {
          var $116 = $112 + $nb | 0;
          var $117 = $116;
          if ($112 >>> 0 >= $116 >>> 0) {
            break;
          }
          var $121 = HEAPU32[$v_3_lcssa$s2 + 6];
          var $123 = HEAPU32[$v_3_lcssa$s2 + 3];
          var $124 = ($123 | 0) == ($v_3_lcssa | 0);
          do {
            if ($124) {
              var $135 = $v_3_lcssa + 20 | 0;
              var $136 = HEAP32[$135 >> 2];
              if (($136 | 0) == 0) {
                var $139 = $v_3_lcssa + 16 | 0;
                var $140 = HEAP32[$139 >> 2];
                if (($140 | 0) == 0) {
                  var $R_1 = 0, $R_1$s2 = $R_1 >> 2;
                  break;
                }
                var $RP_0 = $139;
                var $R_0 = $140;
              } else {
                var $RP_0 = $135;
                var $R_0 = $136;
                __label__ = 28;
              }
              while (1) {
                var $R_0;
                var $RP_0;
                var $142 = $R_0 + 20 | 0;
                var $143 = HEAP32[$142 >> 2];
                if (($143 | 0) != 0) {
                  var $RP_0 = $142;
                  var $R_0 = $143;
                  continue;
                }
                var $146 = $R_0 + 16 | 0;
                var $147 = HEAPU32[$146 >> 2];
                if (($147 | 0) == 0) {
                  break;
                }
                var $RP_0 = $146;
                var $R_0 = $147;
              }
              if ($RP_0 >>> 0 < $113 >>> 0) {
                _abort();
                throw "Reached an unreachable!";
              } else {
                HEAP32[$RP_0 >> 2] = 0;
                var $R_1 = $R_0, $R_1$s2 = $R_1 >> 2;
              }
            } else {
              var $127 = HEAPU32[$v_3_lcssa$s2 + 2];
              if ($127 >>> 0 < $113 >>> 0) {
                _abort();
                throw "Reached an unreachable!";
              } else {
                HEAP32[$127 + 12 >> 2] = $123;
                HEAP32[$123 + 8 >> 2] = $127;
                var $R_1 = $123, $R_1$s2 = $R_1 >> 2;
              }
            }
          } while (0);
          var $R_1;
          var $155 = ($121 | 0) == 0;
          $_$115 : do {
            if ($155) {
              var $v_3_lcssa1 = $v_3_lcssa;
            } else {
              var $157 = $v_3_lcssa + 28 | 0;
              var $159 = (HEAP32[$157 >> 2] << 2) + __gm_ + 304 | 0;
              var $161 = ($v_3_lcssa | 0) == (HEAP32[$159 >> 2] | 0);
              do {
                if ($161) {
                  HEAP32[$159 >> 2] = $R_1;
                  if (($R_1 | 0) != 0) {
                    break;
                  }
                  var $167 = HEAP32[__gm_ + 4 >> 2] & (1 << HEAP32[$157 >> 2] ^ -1);
                  HEAP32[__gm_ + 4 >> 2] = $167;
                  var $v_3_lcssa1 = $v_3_lcssa;
                  break $_$115;
                }
                if ($121 >>> 0 < HEAPU32[__gm_ + 16 >> 2] >>> 0) {
                  _abort();
                  throw "Reached an unreachable!";
                } else {
                  var $173 = $121 + 16 | 0;
                  if ((HEAP32[$173 >> 2] | 0) == ($v_3_lcssa | 0)) {
                    HEAP32[$173 >> 2] = $R_1;
                  } else {
                    HEAP32[$121 + 20 >> 2] = $R_1;
                  }
                  if (($R_1 | 0) == 0) {
                    var $v_3_lcssa1 = $v_3_lcssa;
                    break $_$115;
                  }
                }
              } while (0);
              if ($R_1 >>> 0 < HEAPU32[__gm_ + 16 >> 2] >>> 0) {
                _abort();
                throw "Reached an unreachable!";
              } else {
                HEAP32[$R_1$s2 + 6] = $121;
                var $189 = HEAPU32[$v_3_lcssa$s2 + 4];
                if (($189 | 0) != 0) {
                  if ($189 >>> 0 < HEAPU32[__gm_ + 16 >> 2] >>> 0) {
                    _abort();
                    throw "Reached an unreachable!";
                  } else {
                    HEAP32[$R_1$s2 + 4] = $189;
                    HEAP32[$189 + 24 >> 2] = $R_1;
                  }
                }
                var $201 = HEAPU32[$v_3_lcssa$s2 + 5];
                if (($201 | 0) == 0) {
                  var $v_3_lcssa1 = $v_3_lcssa;
                  break;
                }
                if ($201 >>> 0 < HEAPU32[__gm_ + 16 >> 2] >>> 0) {
                  _abort();
                  throw "Reached an unreachable!";
                } else {
                  HEAP32[$R_1$s2 + 5] = $201;
                  HEAP32[$201 + 24 >> 2] = $R_1;
                  var $v_3_lcssa1 = $v_3_lcssa;
                }
              }
            }
          } while (0);
          var $v_3_lcssa1;
          var $213 = $rsize_3_lcssa >>> 0 < 16;
          $_$143 : do {
            if ($213) {
              var $215 = $rsize_3_lcssa + $nb | 0;
              HEAP32[$v_3_lcssa1 + 4 >> 2] = $215 | 3;
              var $219 = $215 + ($112 + 4) | 0;
              var $221 = HEAP32[$219 >> 2] | 1;
              HEAP32[$219 >> 2] = $221;
            } else {
              HEAP32[$v_3_lcssa1 + 4 >> 2] = $nb | 3;
              HEAP32[$nb$s2 + ($112$s2 + 1)] = $rsize_3_lcssa | 1;
              HEAP32[($rsize_3_lcssa >> 2) + $112$s2 + $nb$s2] = $rsize_3_lcssa;
              if ($rsize_3_lcssa >>> 0 < 256) {
                var $234 = $rsize_3_lcssa >>> 2 & 1073741822;
                var $236 = ($234 << 2) + __gm_ + 40 | 0;
                var $237 = HEAPU32[__gm_ >> 2];
                var $238 = 1 << ($rsize_3_lcssa >>> 3);
                var $240 = ($237 & $238 | 0) == 0;
                do {
                  if ($240) {
                    HEAP32[__gm_ >> 2] = $237 | $238;
                    var $F5_0 = $236;
                    var $_pre_phi = ($234 + 2 << 2) + __gm_ + 40 | 0;
                  } else {
                    var $244 = ($234 + 2 << 2) + __gm_ + 40 | 0;
                    var $245 = HEAPU32[$244 >> 2];
                    if ($245 >>> 0 >= HEAPU32[__gm_ + 16 >> 2] >>> 0) {
                      var $F5_0 = $245;
                      var $_pre_phi = $244;
                      break;
                    }
                    _abort();
                    throw "Reached an unreachable!";
                  }
                } while (0);
                var $_pre_phi;
                var $F5_0;
                HEAP32[$_pre_phi >> 2] = $117;
                HEAP32[$F5_0 + 12 >> 2] = $117;
                HEAP32[$nb$s2 + ($112$s2 + 2)] = $F5_0;
                HEAP32[$nb$s2 + ($112$s2 + 3)] = $236;
              } else {
                var $257 = $116;
                var $258 = $rsize_3_lcssa >>> 8;
                var $259 = ($258 | 0) == 0;
                do {
                  if ($259) {
                    var $I7_0 = 0;
                  } else {
                    if ($rsize_3_lcssa >>> 0 > 16777215) {
                      var $I7_0 = 31;
                      break;
                    }
                    var $265 = ($258 + 1048320 | 0) >>> 16 & 8;
                    var $266 = $258 << $265;
                    var $269 = ($266 + 520192 | 0) >>> 16 & 4;
                    var $270 = $266 << $269;
                    var $273 = ($270 + 245760 | 0) >>> 16 & 2;
                    var $279 = 14 - ($269 | $265 | $273) + ($270 << $273 >>> 15) | 0;
                    var $I7_0 = $rsize_3_lcssa >>> (($279 + 7 | 0) >>> 0) & 1 | $279 << 1;
                  }
                } while (0);
                var $I7_0;
                var $286 = ($I7_0 << 2) + __gm_ + 304 | 0;
                HEAP32[$nb$s2 + ($112$s2 + 7)] = $I7_0;
                var $289 = $nb + ($112 + 16) | 0;
                HEAP32[$nb$s2 + ($112$s2 + 5)] = 0;
                HEAP32[$289 >> 2] = 0;
                var $293 = HEAP32[__gm_ + 4 >> 2];
                var $294 = 1 << $I7_0;
                if (($293 & $294 | 0) == 0) {
                  var $298 = $293 | $294;
                  HEAP32[__gm_ + 4 >> 2] = $298;
                  HEAP32[$286 >> 2] = $257;
                  HEAP32[$nb$s2 + ($112$s2 + 6)] = $286;
                  HEAP32[$nb$s2 + ($112$s2 + 3)] = $257;
                  HEAP32[$nb$s2 + ($112$s2 + 2)] = $257;
                } else {
                  if (($I7_0 | 0) == 31) {
                    var $313 = 0;
                  } else {
                    var $313 = 25 - ($I7_0 >>> 1) | 0;
                  }
                  var $313;
                  var $K12_0 = $rsize_3_lcssa << $313;
                  var $T_0 = HEAP32[$286 >> 2];
                  while (1) {
                    var $T_0;
                    var $K12_0;
                    if ((HEAP32[$T_0 + 4 >> 2] & -8 | 0) == ($rsize_3_lcssa | 0)) {
                      var $339 = $T_0 + 8 | 0;
                      var $340 = HEAPU32[$339 >> 2];
                      var $342 = HEAPU32[__gm_ + 16 >> 2];
                      var $343 = $T_0 >>> 0 < $342 >>> 0;
                      do {
                        if (!$343) {
                          if ($340 >>> 0 < $342 >>> 0) {
                            break;
                          }
                          HEAP32[$340 + 12 >> 2] = $257;
                          HEAP32[$339 >> 2] = $257;
                          HEAP32[$nb$s2 + ($112$s2 + 2)] = $340;
                          HEAP32[$nb$s2 + ($112$s2 + 3)] = $T_0;
                          HEAP32[$nb$s2 + ($112$s2 + 6)] = 0;
                          break $_$143;
                        }
                      } while (0);
                      _abort();
                      throw "Reached an unreachable!";
                    } else {
                      var $322 = ($K12_0 >>> 31 << 2) + $T_0 + 16 | 0;
                      var $323 = HEAPU32[$322 >> 2];
                      if (($323 | 0) != 0) {
                        var $K12_0 = $K12_0 << 1;
                        var $T_0 = $323;
                        continue;
                      }
                      if ($322 >>> 0 >= HEAPU32[__gm_ + 16 >> 2] >>> 0) {
                        HEAP32[$322 >> 2] = $257;
                        HEAP32[$nb$s2 + ($112$s2 + 6)] = $T_0;
                        HEAP32[$nb$s2 + ($112$s2 + 3)] = $257;
                        HEAP32[$nb$s2 + ($112$s2 + 2)] = $257;
                        break $_$143;
                      }
                      _abort();
                      throw "Reached an unreachable!";
                    }
                  }
                }
              }
            }
          } while (0);
          var $_0 = $v_3_lcssa1 + 8 | 0;
          break $_$87;
        }
      } while (0);
      _abort();
      throw "Reached an unreachable!";
    }
  } while (0);
  var $_0;
  return $_0;
  return null;
}

_tmalloc_large["X"] = 1;

function _sys_alloc($nb) {
  var $sp_0$s2;
  var __label__;
  if ((HEAP32[_mparams >> 2] | 0) == 0) {
    _init_mparams();
  }
  var $7 = (HEAP32[__gm_ + 440 >> 2] & 4 | 0) == 0;
  $_$5 : do {
    if ($7) {
      var $9 = HEAP32[__gm_ + 24 >> 2];
      var $10 = ($9 | 0) == 0;
      do {
        if (!$10) {
          var $12 = $9;
          var $13 = _segment_holding($12);
          if (($13 | 0) == 0) {
            __label__ = 7;
            break;
          }
          var $41 = HEAP32[_mparams + 8 >> 2];
          var $46 = $nb + 47 - HEAP32[__gm_ + 12 >> 2] + $41 & -$41;
          if ($46 >>> 0 >= 2147483647) {
            var $tsize_0121720_ph = 0;
            __label__ = 22;
            break;
          }
          var $49 = _sbrk($46);
          var $55 = ($49 | 0) == (HEAP32[$13 >> 2] + HEAP32[$13 + 4 >> 2] | 0);
          var $_1 = $55 ? $46 : 0;
          var $_2 = $55 ? $49 : -1;
          var $tbase_0 = $_2;
          var $tsize_0 = $_1;
          var $asize_1 = $46;
          var $br_0 = $49;
          __label__ = 14;
          break;
        }
        __label__ = 7;
      } while (0);
      do {
        if (__label__ == 7) {
          var $15 = _sbrk(0);
          if (($15 | 0) == -1) {
            var $tsize_0121720_ph = 0;
            __label__ = 22;
            break;
          }
          var $18 = HEAP32[_mparams + 8 >> 2];
          var $22 = $18 + ($nb + 47) & -$18;
          var $23 = $15;
          var $24 = HEAP32[_mparams + 4 >> 2];
          var $25 = $24 - 1 | 0;
          if (($25 & $23 | 0) == 0) {
            var $asize_0 = $22;
          } else {
            var $asize_0 = $22 - $23 + ($25 + $23 & -$24) | 0;
          }
          var $asize_0;
          if ($asize_0 >>> 0 >= 2147483647) {
            var $tsize_0121720_ph = 0;
            __label__ = 22;
            break;
          }
          var $37 = _sbrk($asize_0);
          var $38 = ($37 | 0) == ($15 | 0);
          var $asize_0_ = $38 ? $asize_0 : 0;
          var $_ = $38 ? $15 : -1;
          var $tbase_0 = $_;
          var $tsize_0 = $asize_0_;
          var $asize_1 = $asize_0;
          var $br_0 = $37;
          __label__ = 14;
          break;
        }
      } while (0);
      $_$18 : do {
        if (__label__ == 14) {
          var $br_0;
          var $asize_1;
          var $tsize_0;
          var $tbase_0;
          var $57 = -$asize_1 | 0;
          if (($tbase_0 | 0) != -1) {
            var $tsize_229 = $tsize_0;
            var $tbase_230 = $tbase_0;
            __label__ = 27;
            break $_$5;
          }
          var $or_cond = ($br_0 | 0) != -1 & $asize_1 >>> 0 < 2147483647;
          do {
            if ($or_cond) {
              if ($asize_1 >>> 0 >= ($nb + 48 | 0) >>> 0) {
                var $asize_2 = $asize_1;
                break;
              }
              var $66 = HEAP32[_mparams + 8 >> 2];
              var $71 = $nb + 47 - $asize_1 + $66 & -$66;
              if ($71 >>> 0 >= 2147483647) {
                var $asize_2 = $asize_1;
                break;
              }
              var $74 = _sbrk($71);
              if (($74 | 0) == -1) {
                var $79 = _sbrk($57);
                var $tsize_0121720_ph = $tsize_0;
                break $_$18;
              }
              var $asize_2 = $71 + $asize_1 | 0;
            } else {
              var $asize_2 = $asize_1;
            }
          } while (0);
          var $asize_2;
          if (($br_0 | 0) != -1) {
            var $tsize_229 = $asize_2;
            var $tbase_230 = $br_0;
            __label__ = 27;
            break $_$5;
          }
          var $85 = HEAP32[__gm_ + 440 >> 2] | 4;
          HEAP32[__gm_ + 440 >> 2] = $85;
          var $tsize_125 = $tsize_0;
          __label__ = 24;
          break $_$5;
        }
      } while (0);
      var $tsize_0121720_ph;
      var $83 = HEAP32[__gm_ + 440 >> 2] | 4;
      HEAP32[__gm_ + 440 >> 2] = $83;
      var $tsize_125 = $tsize_0121720_ph;
      __label__ = 24;
      break;
    }
    var $tsize_125 = 0;
    __label__ = 24;
  } while (0);
  do {
    if (__label__ == 24) {
      var $tsize_125;
      var $86 = HEAP32[_mparams + 8 >> 2];
      var $90 = $86 + ($nb + 47) & -$86;
      if ($90 >>> 0 >= 2147483647) {
        __label__ = 50;
        break;
      }
      var $93 = _sbrk($90);
      var $94 = _sbrk(0);
      if (!(($94 | 0) != -1 & ($93 | 0) != -1 & $93 >>> 0 < $94 >>> 0)) {
        __label__ = 50;
        break;
      }
      var $98 = $94 - $93 | 0;
      var $100 = $98 >>> 0 > ($nb + 40 | 0) >>> 0;
      var $_tsize_1 = $100 ? $98 : $tsize_125;
      var $_tbase_1 = $100 ? $93 : -1;
      if (($_tbase_1 | 0) == -1) {
        __label__ = 50;
        break;
      }
      var $tsize_229 = $_tsize_1;
      var $tbase_230 = $_tbase_1;
      __label__ = 27;
      break;
    }
  } while (0);
  $_$35 : do {
    if (__label__ == 27) {
      var $tbase_230;
      var $tsize_229;
      var $103 = HEAP32[__gm_ + 432 >> 2] + $tsize_229 | 0;
      HEAP32[__gm_ + 432 >> 2] = $103;
      if ($103 >>> 0 > HEAPU32[__gm_ + 436 >> 2] >>> 0) {
        HEAP32[__gm_ + 436 >> 2] = $103;
      }
      var $108 = HEAPU32[__gm_ + 24 >> 2];
      var $109 = ($108 | 0) == 0;
      $_$40 : do {
        if ($109) {
          var $111 = HEAPU32[__gm_ + 16 >> 2];
          if (($111 | 0) == 0 | $tbase_230 >>> 0 < $111 >>> 0) {
            HEAP32[__gm_ + 16 >> 2] = $tbase_230;
          }
          HEAP32[__gm_ + 444 >> 2] = $tbase_230;
          HEAP32[__gm_ + 448 >> 2] = $tsize_229;
          HEAP32[__gm_ + 456 >> 2] = 0;
          var $116 = HEAP32[_mparams >> 2];
          HEAP32[__gm_ + 36 >> 2] = $116;
          HEAP32[__gm_ + 32 >> 2] = -1;
          _init_bins();
          _init_top($tbase_230, $tsize_229 - 40 | 0);
        } else {
          var $sp_0 = __gm_ + 444 | 0, $sp_0$s2 = $sp_0 >> 2;
          while (1) {
            var $sp_0;
            if (($sp_0 | 0) == 0) {
              break;
            }
            var $122 = HEAPU32[$sp_0$s2];
            var $123 = $sp_0 + 4 | 0;
            var $124 = HEAPU32[$123 >> 2];
            if (($tbase_230 | 0) == ($122 + $124 | 0)) {
              if ((HEAP32[$sp_0$s2 + 3] & 8 | 0) != 0) {
                break;
              }
              var $135 = $108;
              if (!($135 >>> 0 >= $122 >>> 0 & $135 >>> 0 < $tbase_230 >>> 0)) {
                break;
              }
              HEAP32[$123 >> 2] = $124 + $tsize_229 | 0;
              var $140 = HEAP32[__gm_ + 24 >> 2];
              var $142 = HEAP32[__gm_ + 12 >> 2] + $tsize_229 | 0;
              _init_top($140, $142);
              break $_$40;
            }
            var $sp_0 = HEAP32[$sp_0$s2 + 2], $sp_0$s2 = $sp_0 >> 2;
          }
          if ($tbase_230 >>> 0 < HEAPU32[__gm_ + 16 >> 2] >>> 0) {
            HEAP32[__gm_ + 16 >> 2] = $tbase_230;
          }
          var $146 = $tbase_230 + $tsize_229 | 0;
          var $sp_1 = __gm_ + 444 | 0;
          while (1) {
            var $sp_1;
            if (($sp_1 | 0) == 0) {
              break;
            }
            var $150 = $sp_1 | 0;
            if ((HEAP32[$150 >> 2] | 0) == ($146 | 0)) {
              if ((HEAP32[$sp_1 + 12 >> 2] & 8 | 0) != 0) {
                break;
              }
              HEAP32[$150 >> 2] = $tbase_230;
              var $161 = $sp_1 + 4 | 0;
              var $163 = HEAP32[$161 >> 2] + $tsize_229 | 0;
              HEAP32[$161 >> 2] = $163;
              var $164 = _prepend_alloc($tbase_230, $146, $nb);
              var $_0 = $164;
              __label__ = 51;
              break $_$35;
            }
            var $sp_1 = HEAP32[$sp_1 + 8 >> 2];
          }
          _add_segment($tbase_230, $tsize_229);
        }
      } while (0);
      var $166 = HEAPU32[__gm_ + 12 >> 2];
      if ($166 >>> 0 <= $nb >>> 0) {
        __label__ = 50;
        break;
      }
      var $169 = $166 - $nb | 0;
      HEAP32[__gm_ + 12 >> 2] = $169;
      var $170 = HEAPU32[__gm_ + 24 >> 2];
      var $171 = $170;
      HEAP32[__gm_ + 24 >> 2] = $171 + $nb | 0;
      HEAP32[$nb + ($171 + 4) >> 2] = $169 | 1;
      HEAP32[$170 + 4 >> 2] = $nb | 3;
      var $_0 = $170 + 8 | 0;
      __label__ = 51;
      break;
    }
  } while (0);
  if (__label__ == 50) {
    var $181 = ___errno();
    HEAP32[$181 >> 2] = 12;
    var $_0 = 0;
  }
  var $_0;
  return $_0;
  return null;
}

_sys_alloc["X"] = 1;

function _release_unused_segments() {
  var $sp_0_in = __gm_ + 452 | 0;
  while (1) {
    var $sp_0_in;
    var $sp_0 = HEAP32[$sp_0_in >> 2];
    if (($sp_0 | 0) == 0) {
      break;
    }
    var $sp_0_in = $sp_0 + 8 | 0;
  }
  HEAP32[__gm_ + 32 >> 2] = -1;
  return;
  return;
}

function _sys_trim($pad) {
  var $31$s2;
  if ((HEAP32[_mparams >> 2] | 0) == 0) {
    _init_mparams();
  }
  var $5 = $pad >>> 0 < 4294967232;
  $_$181 : do {
    if ($5) {
      var $7 = HEAPU32[__gm_ + 24 >> 2];
      if (($7 | 0) == 0) {
        var $released_2 = 0;
        break;
      }
      var $11 = HEAPU32[__gm_ + 12 >> 2];
      var $12 = $11 >>> 0 > ($pad + 40 | 0) >>> 0;
      do {
        if ($12) {
          var $14 = HEAPU32[_mparams + 8 >> 2];
          var $17 = -40 - $pad - 1 + $11 + $14 | 0;
          var $18 = Math.floor(($17 >>> 0) / ($14 >>> 0));
          var $20 = ($18 - 1) * $14 | 0;
          var $21 = $7;
          var $22 = _segment_holding($21);
          if ((HEAP32[$22 + 12 >> 2] & 8 | 0) != 0) {
            break;
          }
          var $28 = _sbrk(0);
          var $31$s2 = ($22 + 4 | 0) >> 2;
          if (($28 | 0) != (HEAP32[$22 >> 2] + HEAP32[$31$s2] | 0)) {
            break;
          }
          var $_ = $20 >>> 0 > 2147483646 ? -2147483648 - $14 | 0 : $20;
          var $38 = -$_ | 0;
          var $39 = _sbrk($38);
          var $40 = _sbrk(0);
          if (!(($39 | 0) != -1 & $40 >>> 0 < $28 >>> 0)) {
            break;
          }
          var $46 = $28 - $40 | 0;
          if (($28 | 0) == ($40 | 0)) {
            break;
          }
          var $50 = HEAP32[$31$s2] - $46 | 0;
          HEAP32[$31$s2] = $50;
          var $52 = HEAP32[__gm_ + 432 >> 2] - $46 | 0;
          HEAP32[__gm_ + 432 >> 2] = $52;
          var $53 = HEAP32[__gm_ + 24 >> 2];
          var $55 = HEAP32[__gm_ + 12 >> 2] - $46 | 0;
          _init_top($53, $55);
          var $released_2 = 1;
          break $_$181;
        }
      } while (0);
      if (HEAPU32[__gm_ + 12 >> 2] >>> 0 <= HEAPU32[__gm_ + 28 >> 2] >>> 0) {
        var $released_2 = 0;
        break;
      }
      HEAP32[__gm_ + 28 >> 2] = -1;
      var $released_2 = 0;
    } else {
      var $released_2 = 0;
    }
  } while (0);
  var $released_2;
  return $released_2;
  return null;
}

_sys_trim["X"] = 1;

function _free($mem) {
  var $R7_1$s2;
  var $R_1$s2;
  var $p_0$s2;
  var $165$s2;
  var $_sum2$s2;
  var $14$s2;
  var $mem$s2 = $mem >> 2;
  var __label__;
  var $1 = ($mem | 0) == 0;
  $_$2 : do {
    if (!$1) {
      var $3 = $mem - 8 | 0;
      var $4 = $3;
      var $5 = HEAPU32[__gm_ + 16 >> 2];
      var $6 = $3 >>> 0 < $5 >>> 0;
      $_$4 : do {
        if (!$6) {
          var $10 = HEAPU32[$mem - 4 >> 2];
          var $11 = $10 & 3;
          if (($11 | 0) == 1) {
            break;
          }
          var $14 = $10 & -8, $14$s2 = $14 >> 2;
          var $15 = $mem + ($14 - 8) | 0;
          var $16 = $15;
          var $18 = ($10 & 1 | 0) == 0;
          $_$7 : do {
            if ($18) {
              var $21 = HEAPU32[$3 >> 2];
              if (($11 | 0) == 0) {
                break $_$2;
              }
              var $_sum2 = -8 - $21 | 0, $_sum2$s2 = $_sum2 >> 2;
              var $24 = $mem + $_sum2 | 0;
              var $25 = $24;
              var $26 = $21 + $14 | 0;
              if ($24 >>> 0 < $5 >>> 0) {
                break $_$4;
              }
              if (($25 | 0) == (HEAP32[__gm_ + 20 >> 2] | 0)) {
                var $165$s2 = ($mem + ($14 - 4) | 0) >> 2;
                if ((HEAP32[$165$s2] & 3 | 0) != 3) {
                  var $p_0 = $25, $p_0$s2 = $p_0 >> 2;
                  var $psize_0 = $26;
                  break;
                }
                HEAP32[__gm_ + 8 >> 2] = $26;
                var $171 = HEAP32[$165$s2] & -2;
                HEAP32[$165$s2] = $171;
                HEAP32[$_sum2$s2 + ($mem$s2 + 1)] = $26 | 1;
                HEAP32[$15 >> 2] = $26;
                break $_$2;
              }
              if ($21 >>> 0 < 256) {
                var $37 = HEAPU32[$_sum2$s2 + ($mem$s2 + 2)];
                var $40 = HEAPU32[$_sum2$s2 + ($mem$s2 + 3)];
                if (($37 | 0) == ($40 | 0)) {
                  var $46 = HEAP32[__gm_ >> 2] & (1 << ($21 >>> 3) ^ -1);
                  HEAP32[__gm_ >> 2] = $46;
                  var $p_0 = $25, $p_0$s2 = $p_0 >> 2;
                  var $psize_0 = $26;
                } else {
                  var $51 = (($21 >>> 2 & 1073741822) << 2) + __gm_ + 40 | 0;
                  var $or_cond = ($37 | 0) != ($51 | 0) & $37 >>> 0 < $5 >>> 0;
                  do {
                    if (!$or_cond) {
                      if (!(($40 | 0) == ($51 | 0) | $40 >>> 0 >= $5 >>> 0)) {
                        break;
                      }
                      HEAP32[$37 + 12 >> 2] = $40;
                      HEAP32[$40 + 8 >> 2] = $37;
                      var $p_0 = $25, $p_0$s2 = $p_0 >> 2;
                      var $psize_0 = $26;
                      break $_$7;
                    }
                  } while (0);
                  _abort();
                  throw "Reached an unreachable!";
                }
              } else {
                var $62 = $24;
                var $65 = HEAPU32[$_sum2$s2 + ($mem$s2 + 6)];
                var $68 = HEAPU32[$_sum2$s2 + ($mem$s2 + 3)];
                var $69 = ($68 | 0) == ($62 | 0);
                do {
                  if ($69) {
                    var $82 = $_sum2 + ($mem + 20) | 0;
                    var $83 = HEAP32[$82 >> 2];
                    if (($83 | 0) == 0) {
                      var $87 = $_sum2 + ($mem + 16) | 0;
                      var $88 = HEAP32[$87 >> 2];
                      if (($88 | 0) == 0) {
                        var $R_1 = 0, $R_1$s2 = $R_1 >> 2;
                        break;
                      }
                      var $RP_0 = $87;
                      var $R_0 = $88;
                    } else {
                      var $RP_0 = $82;
                      var $R_0 = $83;
                      __label__ = 22;
                    }
                    while (1) {
                      var $R_0;
                      var $RP_0;
                      var $90 = $R_0 + 20 | 0;
                      var $91 = HEAP32[$90 >> 2];
                      if (($91 | 0) != 0) {
                        var $RP_0 = $90;
                        var $R_0 = $91;
                        continue;
                      }
                      var $94 = $R_0 + 16 | 0;
                      var $95 = HEAPU32[$94 >> 2];
                      if (($95 | 0) == 0) {
                        break;
                      }
                      var $RP_0 = $94;
                      var $R_0 = $95;
                    }
                    if ($RP_0 >>> 0 < $5 >>> 0) {
                      _abort();
                      throw "Reached an unreachable!";
                    } else {
                      HEAP32[$RP_0 >> 2] = 0;
                      var $R_1 = $R_0, $R_1$s2 = $R_1 >> 2;
                    }
                  } else {
                    var $73 = HEAPU32[$_sum2$s2 + ($mem$s2 + 2)];
                    if ($73 >>> 0 < $5 >>> 0) {
                      _abort();
                      throw "Reached an unreachable!";
                    } else {
                      HEAP32[$73 + 12 >> 2] = $68;
                      HEAP32[$68 + 8 >> 2] = $73;
                      var $R_1 = $68, $R_1$s2 = $R_1 >> 2;
                    }
                  }
                } while (0);
                var $R_1;
                if (($65 | 0) == 0) {
                  var $p_0 = $25, $p_0$s2 = $p_0 >> 2;
                  var $psize_0 = $26;
                  break;
                }
                var $106 = $_sum2 + ($mem + 28) | 0;
                var $108 = (HEAP32[$106 >> 2] << 2) + __gm_ + 304 | 0;
                var $110 = ($62 | 0) == (HEAP32[$108 >> 2] | 0);
                do {
                  if ($110) {
                    HEAP32[$108 >> 2] = $R_1;
                    if (($R_1 | 0) != 0) {
                      break;
                    }
                    var $116 = HEAP32[__gm_ + 4 >> 2] & (1 << HEAP32[$106 >> 2] ^ -1);
                    HEAP32[__gm_ + 4 >> 2] = $116;
                    var $p_0 = $25, $p_0$s2 = $p_0 >> 2;
                    var $psize_0 = $26;
                    break $_$7;
                  }
                  if ($65 >>> 0 < HEAPU32[__gm_ + 16 >> 2] >>> 0) {
                    _abort();
                    throw "Reached an unreachable!";
                  } else {
                    var $122 = $65 + 16 | 0;
                    if ((HEAP32[$122 >> 2] | 0) == ($62 | 0)) {
                      HEAP32[$122 >> 2] = $R_1;
                    } else {
                      HEAP32[$65 + 20 >> 2] = $R_1;
                    }
                    if (($R_1 | 0) == 0) {
                      var $p_0 = $25, $p_0$s2 = $p_0 >> 2;
                      var $psize_0 = $26;
                      break $_$7;
                    }
                  }
                } while (0);
                if ($R_1 >>> 0 < HEAPU32[__gm_ + 16 >> 2] >>> 0) {
                  _abort();
                  throw "Reached an unreachable!";
                } else {
                  HEAP32[$R_1$s2 + 6] = $65;
                  var $139 = HEAPU32[$_sum2$s2 + ($mem$s2 + 4)];
                  if (($139 | 0) != 0) {
                    if ($139 >>> 0 < HEAPU32[__gm_ + 16 >> 2] >>> 0) {
                      _abort();
                      throw "Reached an unreachable!";
                    } else {
                      HEAP32[$R_1$s2 + 4] = $139;
                      HEAP32[$139 + 24 >> 2] = $R_1;
                    }
                  }
                  var $152 = HEAPU32[$_sum2$s2 + ($mem$s2 + 5)];
                  if (($152 | 0) == 0) {
                    var $p_0 = $25, $p_0$s2 = $p_0 >> 2;
                    var $psize_0 = $26;
                    break;
                  }
                  if ($152 >>> 0 < HEAPU32[__gm_ + 16 >> 2] >>> 0) {
                    _abort();
                    throw "Reached an unreachable!";
                  } else {
                    HEAP32[$R_1$s2 + 5] = $152;
                    HEAP32[$152 + 24 >> 2] = $R_1;
                    var $p_0 = $25, $p_0$s2 = $p_0 >> 2;
                    var $psize_0 = $26;
                  }
                }
              }
            } else {
              var $p_0 = $4, $p_0$s2 = $p_0 >> 2;
              var $psize_0 = $14;
            }
          } while (0);
          var $psize_0;
          var $p_0;
          var $177 = $p_0;
          if ($177 >>> 0 >= $15 >>> 0) {
            break;
          }
          var $181 = $mem + ($14 - 4) | 0;
          var $182 = HEAPU32[$181 >> 2];
          if (($182 & 1 | 0) == 0) {
            break;
          }
          var $187 = ($182 & 2 | 0) == 0;
          do {
            if ($187) {
              if (($16 | 0) == (HEAP32[__gm_ + 24 >> 2] | 0)) {
                var $193 = HEAP32[__gm_ + 12 >> 2] + $psize_0 | 0;
                HEAP32[__gm_ + 12 >> 2] = $193;
                HEAP32[__gm_ + 24 >> 2] = $p_0;
                var $194 = $193 | 1;
                HEAP32[$p_0$s2 + 1] = $194;
                if (($p_0 | 0) == (HEAP32[__gm_ + 20 >> 2] | 0)) {
                  HEAP32[__gm_ + 20 >> 2] = 0;
                  HEAP32[__gm_ + 8 >> 2] = 0;
                }
                if ($193 >>> 0 <= HEAPU32[__gm_ + 28 >> 2] >>> 0) {
                  break $_$2;
                }
                var $203 = _sys_trim(0);
                break $_$2;
              }
              if (($16 | 0) == (HEAP32[__gm_ + 20 >> 2] | 0)) {
                var $209 = HEAP32[__gm_ + 8 >> 2] + $psize_0 | 0;
                HEAP32[__gm_ + 8 >> 2] = $209;
                HEAP32[__gm_ + 20 >> 2] = $p_0;
                var $210 = $209 | 1;
                HEAP32[$p_0$s2 + 1] = $210;
                var $213 = $177 + $209 | 0;
                HEAP32[$213 >> 2] = $209;
                break $_$2;
              }
              var $216 = ($182 & -8) + $psize_0 | 0;
              var $217 = $182 >>> 3;
              var $218 = $182 >>> 0 < 256;
              $_$82 : do {
                if ($218) {
                  var $222 = HEAPU32[$mem$s2 + $14$s2];
                  var $225 = HEAPU32[(($14 | 4) >> 2) + $mem$s2];
                  if (($222 | 0) == ($225 | 0)) {
                    var $231 = HEAP32[__gm_ >> 2] & (1 << $217 ^ -1);
                    HEAP32[__gm_ >> 2] = $231;
                  } else {
                    var $236 = (($182 >>> 2 & 1073741822) << 2) + __gm_ + 40 | 0;
                    var $237 = ($222 | 0) == ($236 | 0);
                    do {
                      if ($237) {
                        __label__ = 64;
                      } else {
                        if ($222 >>> 0 < HEAPU32[__gm_ + 16 >> 2] >>> 0) {
                          __label__ = 67;
                          break;
                        }
                        __label__ = 64;
                        break;
                      }
                    } while (0);
                    do {
                      if (__label__ == 64) {
                        if (($225 | 0) != ($236 | 0)) {
                          if ($225 >>> 0 < HEAPU32[__gm_ + 16 >> 2] >>> 0) {
                            break;
                          }
                        }
                        HEAP32[$222 + 12 >> 2] = $225;
                        HEAP32[$225 + 8 >> 2] = $222;
                        break $_$82;
                      }
                    } while (0);
                    _abort();
                    throw "Reached an unreachable!";
                  }
                } else {
                  var $251 = $15;
                  var $254 = HEAPU32[$14$s2 + ($mem$s2 + 4)];
                  var $257 = HEAPU32[(($14 | 4) >> 2) + $mem$s2];
                  var $258 = ($257 | 0) == ($251 | 0);
                  do {
                    if ($258) {
                      var $272 = $14 + ($mem + 12) | 0;
                      var $273 = HEAP32[$272 >> 2];
                      if (($273 | 0) == 0) {
                        var $277 = $14 + ($mem + 8) | 0;
                        var $278 = HEAP32[$277 >> 2];
                        if (($278 | 0) == 0) {
                          var $R7_1 = 0, $R7_1$s2 = $R7_1 >> 2;
                          break;
                        }
                        var $RP9_0 = $277;
                        var $R7_0 = $278;
                      } else {
                        var $RP9_0 = $272;
                        var $R7_0 = $273;
                        __label__ = 74;
                      }
                      while (1) {
                        var $R7_0;
                        var $RP9_0;
                        var $280 = $R7_0 + 20 | 0;
                        var $281 = HEAP32[$280 >> 2];
                        if (($281 | 0) != 0) {
                          var $RP9_0 = $280;
                          var $R7_0 = $281;
                          continue;
                        }
                        var $284 = $R7_0 + 16 | 0;
                        var $285 = HEAPU32[$284 >> 2];
                        if (($285 | 0) == 0) {
                          break;
                        }
                        var $RP9_0 = $284;
                        var $R7_0 = $285;
                      }
                      if ($RP9_0 >>> 0 < HEAPU32[__gm_ + 16 >> 2] >>> 0) {
                        _abort();
                        throw "Reached an unreachable!";
                      } else {
                        HEAP32[$RP9_0 >> 2] = 0;
                        var $R7_1 = $R7_0, $R7_1$s2 = $R7_1 >> 2;
                      }
                    } else {
                      var $262 = HEAPU32[$mem$s2 + $14$s2];
                      if ($262 >>> 0 < HEAPU32[__gm_ + 16 >> 2] >>> 0) {
                        _abort();
                        throw "Reached an unreachable!";
                      } else {
                        HEAP32[$262 + 12 >> 2] = $257;
                        HEAP32[$257 + 8 >> 2] = $262;
                        var $R7_1 = $257, $R7_1$s2 = $R7_1 >> 2;
                      }
                    }
                  } while (0);
                  var $R7_1;
                  if (($254 | 0) == 0) {
                    break;
                  }
                  var $297 = $14 + ($mem + 20) | 0;
                  var $299 = (HEAP32[$297 >> 2] << 2) + __gm_ + 304 | 0;
                  var $301 = ($251 | 0) == (HEAP32[$299 >> 2] | 0);
                  do {
                    if ($301) {
                      HEAP32[$299 >> 2] = $R7_1;
                      if (($R7_1 | 0) != 0) {
                        break;
                      }
                      var $307 = HEAP32[__gm_ + 4 >> 2] & (1 << HEAP32[$297 >> 2] ^ -1);
                      HEAP32[__gm_ + 4 >> 2] = $307;
                      break $_$82;
                    }
                    if ($254 >>> 0 < HEAPU32[__gm_ + 16 >> 2] >>> 0) {
                      _abort();
                      throw "Reached an unreachable!";
                    } else {
                      var $313 = $254 + 16 | 0;
                      if ((HEAP32[$313 >> 2] | 0) == ($251 | 0)) {
                        HEAP32[$313 >> 2] = $R7_1;
                      } else {
                        HEAP32[$254 + 20 >> 2] = $R7_1;
                      }
                      if (($R7_1 | 0) == 0) {
                        break $_$82;
                      }
                    }
                  } while (0);
                  if ($R7_1 >>> 0 < HEAPU32[__gm_ + 16 >> 2] >>> 0) {
                    _abort();
                    throw "Reached an unreachable!";
                  } else {
                    HEAP32[$R7_1$s2 + 6] = $254;
                    var $330 = HEAPU32[$14$s2 + ($mem$s2 + 2)];
                    if (($330 | 0) != 0) {
                      if ($330 >>> 0 < HEAPU32[__gm_ + 16 >> 2] >>> 0) {
                        _abort();
                        throw "Reached an unreachable!";
                      } else {
                        HEAP32[$R7_1$s2 + 4] = $330;
                        HEAP32[$330 + 24 >> 2] = $R7_1;
                      }
                    }
                    var $343 = HEAPU32[$14$s2 + ($mem$s2 + 3)];
                    if (($343 | 0) == 0) {
                      break;
                    }
                    if ($343 >>> 0 < HEAPU32[__gm_ + 16 >> 2] >>> 0) {
                      _abort();
                      throw "Reached an unreachable!";
                    } else {
                      HEAP32[$R7_1$s2 + 5] = $343;
                      HEAP32[$343 + 24 >> 2] = $R7_1;
                    }
                  }
                }
              } while (0);
              HEAP32[$p_0$s2 + 1] = $216 | 1;
              HEAP32[$177 + $216 >> 2] = $216;
              if (($p_0 | 0) != (HEAP32[__gm_ + 20 >> 2] | 0)) {
                var $psize_1 = $216;
                break;
              }
              HEAP32[__gm_ + 8 >> 2] = $216;
              break $_$2;
            } else {
              HEAP32[$181 >> 2] = $182 & -2;
              HEAP32[$p_0$s2 + 1] = $psize_0 | 1;
              HEAP32[$177 + $psize_0 >> 2] = $psize_0;
              var $psize_1 = $psize_0;
            }
          } while (0);
          var $psize_1;
          if ($psize_1 >>> 0 < 256) {
            var $373 = $psize_1 >>> 2 & 1073741822;
            var $375 = ($373 << 2) + __gm_ + 40 | 0;
            var $376 = HEAPU32[__gm_ >> 2];
            var $377 = 1 << ($psize_1 >>> 3);
            var $379 = ($376 & $377 | 0) == 0;
            do {
              if ($379) {
                HEAP32[__gm_ >> 2] = $376 | $377;
                var $F16_0 = $375;
                var $_pre_phi = ($373 + 2 << 2) + __gm_ + 40 | 0;
              } else {
                var $383 = ($373 + 2 << 2) + __gm_ + 40 | 0;
                var $384 = HEAPU32[$383 >> 2];
                if ($384 >>> 0 >= HEAPU32[__gm_ + 16 >> 2] >>> 0) {
                  var $F16_0 = $384;
                  var $_pre_phi = $383;
                  break;
                }
                _abort();
                throw "Reached an unreachable!";
              }
            } while (0);
            var $_pre_phi;
            var $F16_0;
            HEAP32[$_pre_phi >> 2] = $p_0;
            HEAP32[$F16_0 + 12 >> 2] = $p_0;
            HEAP32[$p_0$s2 + 2] = $F16_0;
            HEAP32[$p_0$s2 + 3] = $375;
            break $_$2;
          }
          var $394 = $p_0;
          var $395 = $psize_1 >>> 8;
          var $396 = ($395 | 0) == 0;
          do {
            if ($396) {
              var $I18_0 = 0;
            } else {
              if ($psize_1 >>> 0 > 16777215) {
                var $I18_0 = 31;
                break;
              }
              var $402 = ($395 + 1048320 | 0) >>> 16 & 8;
              var $403 = $395 << $402;
              var $406 = ($403 + 520192 | 0) >>> 16 & 4;
              var $407 = $403 << $406;
              var $410 = ($407 + 245760 | 0) >>> 16 & 2;
              var $416 = 14 - ($406 | $402 | $410) + ($407 << $410 >>> 15) | 0;
              var $I18_0 = $psize_1 >>> (($416 + 7 | 0) >>> 0) & 1 | $416 << 1;
            }
          } while (0);
          var $I18_0;
          var $423 = ($I18_0 << 2) + __gm_ + 304 | 0;
          HEAP32[$p_0$s2 + 7] = $I18_0;
          HEAP32[$p_0$s2 + 5] = 0;
          HEAP32[$p_0$s2 + 4] = 0;
          var $427 = HEAP32[__gm_ + 4 >> 2];
          var $428 = 1 << $I18_0;
          var $430 = ($427 & $428 | 0) == 0;
          $_$154 : do {
            if ($430) {
              var $432 = $427 | $428;
              HEAP32[__gm_ + 4 >> 2] = $432;
              HEAP32[$423 >> 2] = $394;
              HEAP32[$p_0$s2 + 6] = $423;
              HEAP32[$p_0$s2 + 3] = $p_0;
              HEAP32[$p_0$s2 + 2] = $p_0;
            } else {
              if (($I18_0 | 0) == 31) {
                var $443 = 0;
              } else {
                var $443 = 25 - ($I18_0 >>> 1) | 0;
              }
              var $443;
              var $K19_0 = $psize_1 << $443;
              var $T_0 = HEAP32[$423 >> 2];
              while (1) {
                var $T_0;
                var $K19_0;
                if ((HEAP32[$T_0 + 4 >> 2] & -8 | 0) == ($psize_1 | 0)) {
                  var $466 = $T_0 + 8 | 0;
                  var $467 = HEAPU32[$466 >> 2];
                  var $469 = HEAPU32[__gm_ + 16 >> 2];
                  var $470 = $T_0 >>> 0 < $469 >>> 0;
                  do {
                    if (!$470) {
                      if ($467 >>> 0 < $469 >>> 0) {
                        break;
                      }
                      HEAP32[$467 + 12 >> 2] = $394;
                      HEAP32[$466 >> 2] = $394;
                      HEAP32[$p_0$s2 + 2] = $467;
                      HEAP32[$p_0$s2 + 3] = $T_0;
                      HEAP32[$p_0$s2 + 6] = 0;
                      break $_$154;
                    }
                  } while (0);
                  _abort();
                  throw "Reached an unreachable!";
                } else {
                  var $452 = ($K19_0 >>> 31 << 2) + $T_0 + 16 | 0;
                  var $453 = HEAPU32[$452 >> 2];
                  if (($453 | 0) != 0) {
                    var $K19_0 = $K19_0 << 1;
                    var $T_0 = $453;
                    continue;
                  }
                  if ($452 >>> 0 >= HEAPU32[__gm_ + 16 >> 2] >>> 0) {
                    HEAP32[$452 >> 2] = $394;
                    HEAP32[$p_0$s2 + 6] = $T_0;
                    HEAP32[$p_0$s2 + 3] = $p_0;
                    HEAP32[$p_0$s2 + 2] = $p_0;
                    break $_$154;
                  }
                  _abort();
                  throw "Reached an unreachable!";
                }
              }
            }
          } while (0);
          var $481 = HEAP32[__gm_ + 32 >> 2] - 1 | 0;
          HEAP32[__gm_ + 32 >> 2] = $481;
          if (($481 | 0) != 0) {
            break $_$2;
          }
          _release_unused_segments();
          break $_$2;
        }
      } while (0);
      _abort();
      throw "Reached an unreachable!";
    }
  } while (0);
  return;
  return;
}

Module["_free"] = _free;

_free["X"] = 1;

function _malloc_footprint() {
  return HEAP32[__gm_ + 432 >> 2];
  return null;
}

function _malloc_max_footprint() {
  return HEAP32[__gm_ + 436 >> 2];
  return null;
}

function _malloc_usable_size($mem) {
  var $1 = ($mem | 0) == 0;
  do {
    if ($1) {
      var $_0 = 0;
    } else {
      var $5 = HEAP32[$mem - 4 >> 2];
      var $6 = $5 & 3;
      if (($6 | 0) == 1) {
        var $_0 = 0;
        break;
      }
      var $11 = ($6 | 0) == 0 ? 8 : 4;
      var $_0 = ($5 & -8) - $11 | 0;
    }
  } while (0);
  var $_0;
  return $_0;
  return null;
}

function _mmap_resize($oldp, $nb) {
  var $3 = HEAP32[$oldp + 4 >> 2] & -8;
  var $4 = $nb >>> 0 < 256;
  do {
    if ($4) {
      var $_0 = 0;
    } else {
      if ($3 >>> 0 >= ($nb + 4 | 0) >>> 0) {
        if (($3 - $nb | 0) >>> 0 <= HEAP32[_mparams + 8 >> 2] << 1 >>> 0) {
          var $_0 = $oldp;
          break;
        }
      }
      var $_0 = 0;
    }
  } while (0);
  var $_0;
  return $_0;
  return null;
}

function _calloc($n_elements, $elem_size) {
  var $1 = ($n_elements | 0) == 0;
  do {
    if ($1) {
      var $req_0 = 0;
    } else {
      var $3 = $elem_size * $n_elements | 0;
      if (($elem_size | $n_elements) >>> 0 <= 65535) {
        var $req_0 = $3;
        break;
      }
      var $7 = Math.floor(($3 >>> 0) / ($n_elements >>> 0));
      var $_ = ($7 | 0) == ($elem_size | 0) ? $3 : -1;
      var $req_0 = $_;
    }
  } while (0);
  var $req_0;
  var $10 = _malloc($req_0);
  var $11 = ($10 | 0) == 0;
  do {
    if (!$11) {
      if ((HEAP32[$10 - 4 >> 2] & 3 | 0) == 0) {
        break;
      }
      _memset($10, 0, $req_0, 1);
    }
  } while (0);
  return $10;
  return null;
}

function _realloc($oldmem, $bytes) {
  if (($oldmem | 0) == 0) {
    var $3 = _malloc($bytes);
    var $_0 = $3;
  } else {
    var $5 = _internal_realloc($oldmem, $bytes);
    var $_0 = $5;
  }
  var $_0;
  return $_0;
  return null;
}

function _memalign($alignment, $bytes) {
  var $1 = _internal_memalign($alignment, $bytes);
  return $1;
  return null;
}

function _internal_memalign($alignment, $bytes) {
  var $49$s2;
  var $1 = $alignment >>> 0 < 9;
  do {
    if ($1) {
      var $3 = _malloc($bytes);
      var $_0 = $3;
    } else {
      var $_alignment = $alignment >>> 0 < 16 ? 16 : $alignment;
      var $8 = ($_alignment - 1 & $_alignment | 0) == 0;
      $_$50 : do {
        if ($8) {
          var $_1 = $_alignment;
        } else {
          var $a_0 = 16;
          while (1) {
            var $a_0;
            if ($a_0 >>> 0 >= $_alignment >>> 0) {
              var $_1 = $a_0;
              break $_$50;
            }
            var $a_0 = $a_0 << 1;
          }
        }
      } while (0);
      var $_1;
      if ((-64 - $_1 | 0) >>> 0 > $bytes >>> 0) {
        if ($bytes >>> 0 < 11) {
          var $21 = 16;
        } else {
          var $21 = $bytes + 11 & -8;
        }
        var $21;
        var $24 = _malloc($21 + ($_1 + 12) | 0);
        if (($24 | 0) == 0) {
          var $_0 = 0;
          break;
        }
        var $27 = $24 - 8 | 0;
        if ((($24 >>> 0) % ($_1 >>> 0) | 0) == 0) {
          var $p_0_in = $27;
          var $leader_1 = 0;
        } else {
          var $36 = $24 + ($_1 - 1) & -$_1;
          var $37 = $36 - 8 | 0;
          var $39 = $27;
          if (($37 - $39 | 0) >>> 0 > 15) {
            var $45 = $37;
          } else {
            var $45 = $36 + ($_1 - 8) | 0;
          }
          var $45;
          var $47 = $45 - $39 | 0;
          var $49$s2 = ($24 - 4 | 0) >> 2;
          var $50 = HEAP32[$49$s2];
          var $52 = ($50 & -8) - $47 | 0;
          if (($50 & 3 | 0) == 0) {
            var $58 = HEAP32[$27 >> 2] + $47 | 0;
            HEAP32[$45 >> 2] = $58;
            HEAP32[$45 + 4 >> 2] = $52;
            var $p_0_in = $45;
            var $leader_1 = 0;
          } else {
            var $64 = $45 + 4 | 0;
            var $68 = $52 | HEAP32[$64 >> 2] & 1 | 2;
            HEAP32[$64 >> 2] = $68;
            var $70 = $52 + ($45 + 4) | 0;
            var $72 = HEAP32[$70 >> 2] | 1;
            HEAP32[$70 >> 2] = $72;
            var $76 = $47 | HEAP32[$49$s2] & 1 | 2;
            HEAP32[$49$s2] = $76;
            var $78 = $24 + ($47 - 4) | 0;
            var $80 = HEAP32[$78 >> 2] | 1;
            HEAP32[$78 >> 2] = $80;
            var $p_0_in = $45;
            var $leader_1 = $24;
          }
        }
        var $leader_1;
        var $p_0_in;
        var $82 = $p_0_in + 4 | 0;
        var $83 = HEAPU32[$82 >> 2];
        var $85 = ($83 & 3 | 0) == 0;
        do {
          if ($85) {
            var $trailer_0 = 0;
          } else {
            var $87 = $83 & -8;
            if ($87 >>> 0 <= ($21 + 16 | 0) >>> 0) {
              var $trailer_0 = 0;
              break;
            }
            var $91 = $87 - $21 | 0;
            HEAP32[$82 >> 2] = $21 | $83 & 1 | 2;
            HEAP32[$p_0_in + ($21 | 4) >> 2] = $91 | 3;
            var $99 = $p_0_in + ($87 | 4) | 0;
            var $101 = HEAP32[$99 >> 2] | 1;
            HEAP32[$99 >> 2] = $101;
            var $trailer_0 = $21 + ($p_0_in + 8) | 0;
          }
        } while (0);
        var $trailer_0;
        if (($leader_1 | 0) != 0) {
          _free($leader_1);
        }
        if (($trailer_0 | 0) != 0) {
          _free($trailer_0);
        }
        var $_0 = $p_0_in + 8 | 0;
      } else {
        var $14 = ___errno();
        HEAP32[$14 >> 2] = 12;
        var $_0 = 0;
      }
    }
  } while (0);
  var $_0;
  return $_0;
  return null;
}

_internal_memalign["X"] = 1;

function _independent_calloc($n_elements, $elem_size, $chunks) {
  var __stackBase__ = STACKTOP;
  STACKTOP += 4;
  assert(STACKTOP % 4 == 0, "Stack is unaligned");
  assert(STACKTOP < STACK_MAX, "Ran out of stack");
  var $sz = __stackBase__;
  HEAP32[$sz >> 2] = $elem_size;
  var $1 = _ialloc($n_elements, $sz, 3, $chunks);
  STACKTOP = __stackBase__;
  return $1;
  return null;
}

function _ialloc($n_elements, $sizes, $opts, $chunks) {
  var __label__;
  if ((HEAP32[_mparams >> 2] | 0) == 0) {
    _init_mparams();
  }
  var $5 = ($chunks | 0) == 0;
  var $6 = ($n_elements | 0) == 0;
  do {
    if ($5) {
      if ($6) {
        var $10 = _malloc(0);
        var $_0 = $10;
        __label__ = 30;
        break;
      }
      var $13 = $n_elements << 2;
      if ($13 >>> 0 < 11) {
        var $marray_0 = 0;
        var $array_size_0 = 16;
        __label__ = 10;
        break;
      }
      var $marray_0 = 0;
      var $array_size_0 = $13 + 11 & -8;
      __label__ = 10;
      break;
    } else {
      if ($6) {
        var $_0 = $chunks;
        __label__ = 30;
        break;
      }
      var $marray_0 = $chunks;
      var $array_size_0 = 0;
      __label__ = 10;
      break;
    }
  } while (0);
  do {
    if (__label__ == 10) {
      var $array_size_0;
      var $marray_0;
      var $20 = ($opts & 1 | 0) == 0;
      $_$95 : do {
        if ($20) {
          if ($6) {
            var $element_size_0 = 0;
            var $contents_size_1 = 0;
            break;
          }
          var $contents_size_07 = 0;
          var $i_08 = 0;
          while (1) {
            var $i_08;
            var $contents_size_07;
            var $31 = HEAPU32[$sizes + ($i_08 << 2) >> 2];
            if ($31 >>> 0 < 11) {
              var $37 = 16;
            } else {
              var $37 = $31 + 11 & -8;
            }
            var $37;
            var $38 = $37 + $contents_size_07 | 0;
            var $39 = $i_08 + 1 | 0;
            if (($39 | 0) == ($n_elements | 0)) {
              var $element_size_0 = 0;
              var $contents_size_1 = $38;
              break $_$95;
            }
            var $contents_size_07 = $38;
            var $i_08 = $39;
          }
        } else {
          var $22 = HEAPU32[$sizes >> 2];
          if ($22 >>> 0 < 11) {
            var $28 = 16;
          } else {
            var $28 = $22 + 11 & -8;
          }
          var $28;
          var $element_size_0 = $28;
          var $contents_size_1 = $28 * $n_elements | 0;
        }
      } while (0);
      var $contents_size_1;
      var $element_size_0;
      var $43 = _malloc($array_size_0 - 4 + $contents_size_1 | 0);
      if (($43 | 0) == 0) {
        var $_0 = 0;
        break;
      }
      var $46 = $43 - 8 | 0;
      var $50 = HEAP32[$43 - 4 >> 2] & -8;
      if (($opts & 2 | 0) != 0) {
        var $55 = -4 - $array_size_0 + $50 | 0;
        _memset($43, 0, $55, 4);
      }
      if (($marray_0 | 0) == 0) {
        var $61 = $43 + $contents_size_1 | 0;
        var $62 = $50 - $contents_size_1 | 3;
        HEAP32[$43 + ($contents_size_1 - 4) >> 2] = $62;
        var $marray_1 = $61;
        var $remainder_size_0 = $contents_size_1;
      } else {
        var $marray_1 = $marray_0;
        var $remainder_size_0 = $50;
      }
      var $remainder_size_0;
      var $marray_1;
      HEAP32[$marray_1 >> 2] = $43;
      var $66 = $n_elements - 1 | 0;
      var $67 = ($66 | 0) == 0;
      $_$114 : do {
        if ($67) {
          var $p_0_in_lcssa = $46;
          var $remainder_size_1_lcssa = $remainder_size_0;
        } else {
          var $68 = ($element_size_0 | 0) == 0;
          var $p_0_in3 = $46;
          var $remainder_size_14 = $remainder_size_0;
          var $i_15 = 0;
          while (1) {
            var $i_15;
            var $remainder_size_14;
            var $p_0_in3;
            do {
              if ($68) {
                var $72 = HEAPU32[$sizes + ($i_15 << 2) >> 2];
                if ($72 >>> 0 < 11) {
                  var $size_0 = 16;
                  break;
                }
                var $size_0 = $72 + 11 & -8;
              } else {
                var $size_0 = $element_size_0;
              }
            } while (0);
            var $size_0;
            var $78 = $remainder_size_14 - $size_0 | 0;
            HEAP32[$p_0_in3 + 4 >> 2] = $size_0 | 3;
            var $82 = $p_0_in3 + $size_0 | 0;
            var $83 = $i_15 + 1 | 0;
            HEAP32[$marray_1 + ($83 << 2) >> 2] = $size_0 + ($p_0_in3 + 8) | 0;
            if (($83 | 0) == ($66 | 0)) {
              var $p_0_in_lcssa = $82;
              var $remainder_size_1_lcssa = $78;
              break $_$114;
            }
            var $p_0_in3 = $82;
            var $remainder_size_14 = $78;
            var $i_15 = $83;
          }
        }
      } while (0);
      var $remainder_size_1_lcssa;
      var $p_0_in_lcssa;
      HEAP32[$p_0_in_lcssa + 4 >> 2] = $remainder_size_1_lcssa | 3;
      var $_0 = $marray_1;
    }
  } while (0);
  var $_0;
  return $_0;
  return null;
}

_ialloc["X"] = 1;

function _independent_comalloc($n_elements, $sizes, $chunks) {
  var $1 = _ialloc($n_elements, $sizes, 0, $chunks);
  return $1;
  return null;
}

function _valloc($bytes) {
  if ((HEAP32[_mparams >> 2] | 0) == 0) {
    _init_mparams();
  }
  var $5 = HEAP32[_mparams + 4 >> 2];
  var $6 = _memalign($5, $bytes);
  return $6;
  return null;
}

function _pvalloc($bytes) {
  if ((HEAP32[_mparams >> 2] | 0) == 0) {
    _init_mparams();
  }
  var $5 = HEAP32[_mparams + 4 >> 2];
  var $9 = $bytes - 1 + $5 & -$5;
  var $10 = _memalign($5, $9);
  return $10;
  return null;
}

function _malloc_trim($pad) {
  if ((HEAP32[_mparams >> 2] | 0) == 0) {
    _init_mparams();
  }
  var $5 = _sys_trim($pad);
  return $5;
  return null;
}

function _mallinfo($agg_result) {
  _internal_mallinfo($agg_result);
  return;
  return;
}

function _internal_mallinfo($agg_result) {
  var $agg_result$s2 = $agg_result >> 2;
  if ((HEAP32[_mparams >> 2] | 0) == 0) {
    _init_mparams();
  }
  var $5 = HEAPU32[__gm_ + 24 >> 2];
  if (($5 | 0) == 0) {
    var $nm_0_0 = 0;
    var $nm_1_0 = 0;
    var $nm_9_0 = 0;
    var $nm_8_0 = 0;
    var $nm_4_0 = 0;
    var $nm_5_0 = 0;
    var $nm_7_0 = 0;
  } else {
    var $8 = HEAPU32[__gm_ + 12 >> 2];
    var $9 = $8 + 40 | 0;
    var $s_02 = __gm_ + 444 | 0;
    var $sum_03 = $9;
    var $mfree_04 = $9;
    var $nfree_05 = 1;
    while (1) {
      var $nfree_05;
      var $mfree_04;
      var $sum_03;
      var $s_02;
      var $12 = HEAPU32[$s_02 >> 2];
      var $14 = $12 + 8 | 0;
      if (($14 & 7 | 0) == 0) {
        var $21 = 0;
      } else {
        var $21 = -$14 & 7;
      }
      var $21;
      var $23 = $s_02 + 4 | 0;
      var $q_0_in = $12 + $21 | 0;
      var $nfree_1 = $nfree_05;
      var $mfree_1 = $mfree_04;
      var $sum_1 = $sum_03;
      while (1) {
        var $sum_1;
        var $mfree_1;
        var $nfree_1;
        var $q_0_in;
        if ($q_0_in >>> 0 < $12 >>> 0) {
          break;
        }
        if ($q_0_in >>> 0 >= ($12 + HEAP32[$23 >> 2] | 0) >>> 0 | ($q_0_in | 0) == ($5 | 0)) {
          break;
        }
        var $34 = HEAP32[$q_0_in + 4 >> 2];
        if (($34 | 0) == 7) {
          break;
        }
        var $37 = $34 & -8;
        var $38 = $37 + $sum_1 | 0;
        if (($34 & 3 | 0) == 1) {
          var $nfree_2 = $nfree_1 + 1 | 0;
          var $mfree_2 = $37 + $mfree_1 | 0;
        } else {
          var $nfree_2 = $nfree_1;
          var $mfree_2 = $mfree_1;
        }
        var $mfree_2;
        var $nfree_2;
        var $q_0_in = $q_0_in + $37 | 0;
        var $nfree_1 = $nfree_2;
        var $mfree_1 = $mfree_2;
        var $sum_1 = $38;
      }
      var $47 = HEAPU32[$s_02 + 8 >> 2];
      if (($47 | 0) == 0) {
        break;
      }
      var $s_02 = $47;
      var $sum_03 = $sum_1;
      var $mfree_04 = $mfree_1;
      var $nfree_05 = $nfree_1;
    }
    var $50 = HEAP32[__gm_ + 432 >> 2];
    var $nm_0_0 = $sum_1;
    var $nm_1_0 = $nfree_1;
    var $nm_9_0 = $8;
    var $nm_8_0 = $mfree_1;
    var $nm_4_0 = $50 - $sum_1 | 0;
    var $nm_5_0 = HEAP32[__gm_ + 436 >> 2];
    var $nm_7_0 = $50 - $mfree_1 | 0;
  }
  var $nm_7_0;
  var $nm_5_0;
  var $nm_4_0;
  var $nm_8_0;
  var $nm_9_0;
  var $nm_1_0;
  var $nm_0_0;
  HEAP32[$agg_result$s2] = $nm_0_0;
  HEAP32[$agg_result$s2 + 1] = $nm_1_0;
  HEAP32[$agg_result$s2 + 2] = 0;
  HEAP32[$agg_result$s2 + 3] = 0;
  HEAP32[$agg_result$s2 + 4] = $nm_4_0;
  HEAP32[$agg_result$s2 + 5] = $nm_5_0;
  HEAP32[$agg_result$s2 + 6] = 0;
  HEAP32[$agg_result$s2 + 7] = $nm_7_0;
  HEAP32[$agg_result$s2 + 8] = $nm_8_0;
  HEAP32[$agg_result$s2 + 9] = $nm_9_0;
  return;
  return;
}

_internal_mallinfo["X"] = 1;

function _malloc_stats() {
  _internal_malloc_stats();
  return;
  return;
}

function _internal_malloc_stats() {
  if ((HEAP32[_mparams >> 2] | 0) == 0) {
    _init_mparams();
  }
  var $5 = HEAPU32[__gm_ + 24 >> 2];
  var $6 = ($5 | 0) == 0;
  $_$174 : do {
    if ($6) {
      var $maxfp_0 = 0;
      var $fp_0 = 0;
      var $used_3 = 0;
    } else {
      var $8 = HEAP32[__gm_ + 436 >> 2];
      var $9 = HEAPU32[__gm_ + 432 >> 2];
      var $s_03 = __gm_ + 444 | 0;
      var $used_04 = $9 - 40 - HEAP32[__gm_ + 12 >> 2] | 0;
      while (1) {
        var $used_04;
        var $s_03;
        var $14 = HEAPU32[$s_03 >> 2];
        var $16 = $14 + 8 | 0;
        if (($16 & 7 | 0) == 0) {
          var $23 = 0;
        } else {
          var $23 = -$16 & 7;
        }
        var $23;
        var $25 = $s_03 + 4 | 0;
        var $q_0_in = $14 + $23 | 0;
        var $used_1 = $used_04;
        while (1) {
          var $used_1;
          var $q_0_in;
          if ($q_0_in >>> 0 < $14 >>> 0) {
            break;
          }
          if ($q_0_in >>> 0 >= ($14 + HEAP32[$25 >> 2] | 0) >>> 0 | ($q_0_in | 0) == ($5 | 0)) {
            break;
          }
          var $36 = HEAP32[$q_0_in + 4 >> 2];
          if (($36 | 0) == 7) {
            break;
          }
          var $40 = $36 & -8;
          var $41 = ($36 & 3 | 0) == 1 ? $40 : 0;
          var $used_2 = $used_1 - $41 | 0;
          var $q_0_in = $q_0_in + $40 | 0;
          var $used_1 = $used_2;
        }
        var $44 = HEAPU32[$s_03 + 8 >> 2];
        if (($44 | 0) == 0) {
          var $maxfp_0 = $8;
          var $fp_0 = $9;
          var $used_3 = $used_1;
          break $_$174;
        }
        var $s_03 = $44;
        var $used_04 = $used_1;
      }
    }
  } while (0);
  var $used_3;
  var $fp_0;
  var $maxfp_0;
  var $46 = HEAP32[_stderr >> 2];
  var $47 = _fprintf($46, STRING_TABLE.__str63 | 0, (tempInt = STACKTOP, STACKTOP += 4, assert(STACKTOP < STACK_ROOT + STACK_MAX, "Ran out of stack"), HEAP32[tempInt >> 2] = $maxfp_0, tempInt));
  var $48 = HEAP32[_stderr >> 2];
  var $49 = _fprintf($48, STRING_TABLE.__str164 | 0, (tempInt = STACKTOP, STACKTOP += 4, assert(STACKTOP < STACK_ROOT + STACK_MAX, "Ran out of stack"), HEAP32[tempInt >> 2] = $fp_0, tempInt));
  var $50 = HEAP32[_stderr >> 2];
  var $51 = _fprintf($50, STRING_TABLE.__str265 | 0, (tempInt = STACKTOP, STACKTOP += 4, assert(STACKTOP < STACK_ROOT + STACK_MAX, "Ran out of stack"), HEAP32[tempInt >> 2] = $used_3, tempInt));
  return;
  return;
}

_internal_malloc_stats["X"] = 1;

function _mallopt($param_number, $value) {
  var $1 = _change_mparam($param_number, $value);
  return $1;
  return null;
}

function _change_mparam($param_number, $value) {
  var __label__;
  if ((HEAP32[_mparams >> 2] | 0) == 0) {
    _init_mparams();
  } else {
    __label__ = 4;
  }
  do {
    if (($param_number | 0) == -1) {
      HEAP32[_mparams + 16 >> 2] = $value;
      var $_0 = 1;
    } else if (($param_number | 0) == -2) {
      if (HEAPU32[_mparams + 4 >> 2] >>> 0 > $value >>> 0) {
        var $_0 = 0;
        break;
      }
      if (($value - 1 & $value | 0) != 0) {
        var $_0 = 0;
        break;
      }
      HEAP32[_mparams + 8 >> 2] = $value;
      var $_0 = 1;
    } else if (($param_number | 0) == -3) {
      HEAP32[_mparams + 12 >> 2] = $value;
      var $_0 = 1;
    } else {
      var $_0 = 0;
    }
  } while (0);
  var $_0;
  return $_0;
  return null;
}

function _internal_realloc($oldmem, $bytes) {
  var $21$s2;
  var $8$s2;
  var __label__;
  var $1 = $bytes >>> 0 > 4294967231;
  $_$16 : do {
    if ($1) {
      var $3 = ___errno();
      HEAP32[$3 >> 2] = 12;
      var $_0 = 0;
    } else {
      var $5 = $oldmem - 8 | 0;
      var $6 = $5;
      var $8$s2 = ($oldmem - 4 | 0) >> 2;
      var $9 = HEAPU32[$8$s2];
      var $10 = $9 & -8;
      var $_sum = $10 - 8 | 0;
      var $12 = $oldmem + $_sum | 0;
      var $14 = $5 >>> 0 < HEAPU32[__gm_ + 16 >> 2] >>> 0;
      do {
        if (!$14) {
          var $16 = $9 & 3;
          if (!(($16 | 0) != 1 & ($_sum | 0) > -8)) {
            break;
          }
          var $21$s2 = ($oldmem + ($10 - 4) | 0) >> 2;
          if ((HEAP32[$21$s2] & 1 | 0) == 0) {
            break;
          }
          if ($bytes >>> 0 < 11) {
            var $31 = 16;
          } else {
            var $31 = $bytes + 11 & -8;
          }
          var $31;
          var $32 = ($16 | 0) == 0;
          do {
            if ($32) {
              var $34 = _mmap_resize($6, $31);
              var $extra_0 = 0;
              var $newp_0 = $34;
              __label__ = 18;
              break;
            }
            if ($10 >>> 0 < $31 >>> 0) {
              if (($12 | 0) != (HEAP32[__gm_ + 24 >> 2] | 0)) {
                __label__ = 22;
                break;
              }
              var $55 = HEAP32[__gm_ + 12 >> 2] + $10 | 0;
              if ($55 >>> 0 <= $31 >>> 0) {
                __label__ = 22;
                break;
              }
              var $58 = $55 - $31 | 0;
              var $60 = $oldmem + ($31 - 8) | 0;
              HEAP32[$8$s2] = $31 | $9 & 1 | 2;
              var $66 = $58 | 1;
              HEAP32[$oldmem + ($31 - 4) >> 2] = $66;
              HEAP32[__gm_ + 24 >> 2] = $60;
              HEAP32[__gm_ + 12 >> 2] = $58;
              var $extra_0 = 0;
              var $newp_0 = $6;
              __label__ = 18;
              break;
            }
            var $38 = $10 - $31 | 0;
            if ($38 >>> 0 <= 15) {
              var $extra_0 = 0;
              var $newp_0 = $6;
              __label__ = 18;
              break;
            }
            HEAP32[$8$s2] = $31 | $9 & 1 | 2;
            HEAP32[$oldmem + ($31 - 4) >> 2] = $38 | 3;
            var $48 = HEAP32[$21$s2] | 1;
            HEAP32[$21$s2] = $48;
            var $extra_0 = $oldmem + $31 | 0;
            var $newp_0 = $6;
            __label__ = 18;
            break;
          } while (0);
          do {
            if (__label__ == 18) {
              var $newp_0;
              var $extra_0;
              if (($newp_0 | 0) == 0) {
                break;
              }
              if (($extra_0 | 0) != 0) {
                _free($extra_0);
              }
              var $_0 = $newp_0 + 8 | 0;
              break $_$16;
            }
          } while (0);
          var $75 = _malloc($bytes);
          if (($75 | 0) == 0) {
            var $_0 = 0;
            break $_$16;
          }
          var $81 = (HEAP32[$8$s2] & 3 | 0) == 0 ? 8 : 4;
          var $82 = $10 - $81 | 0;
          var $84 = $82 >>> 0 < $bytes >>> 0 ? $82 : $bytes;
          assert($84 % 1 === 0, "memcpy given " + $84 + " bytes to copy. Problem with quantum=1 corrections perhaps?");
          _memcpy($75, $oldmem, $84, 1);
          _free($oldmem);
          var $_0 = $75;
          break $_$16;
        }
      } while (0);
      _abort();
      throw "Reached an unreachable!";
    }
  } while (0);
  var $_0;
  return $_0;
  return null;
}

_internal_realloc["X"] = 1;

function _init_mparams() {
  if ((HEAP32[_mparams >> 2] | 0) == 0) {
    var $4 = _sysconf(8);
    if (($4 - 1 & $4 | 0) == 0) {
      HEAP32[_mparams + 8 >> 2] = $4;
      HEAP32[_mparams + 4 >> 2] = $4;
      HEAP32[_mparams + 12 >> 2] = -1;
      HEAP32[_mparams + 16 >> 2] = 2097152;
      HEAP32[_mparams + 20 >> 2] = 0;
      HEAP32[__gm_ + 440 >> 2] = 0;
      var $10 = _time(0);
      HEAP32[_mparams >> 2] = $10 & -16 ^ 1431655768;
    } else {
      _abort();
      throw "Reached an unreachable!";
    }
  }
  return;
  return;
}

function _segment_holding($addr) {
  var $sp_0$s2;
  var $sp_0 = __gm_ + 444 | 0, $sp_0$s2 = $sp_0 >> 2;
  while (1) {
    var $sp_0;
    var $3 = HEAPU32[$sp_0$s2];
    if ($3 >>> 0 <= $addr >>> 0) {
      if (($3 + HEAP32[$sp_0$s2 + 1] | 0) >>> 0 > $addr >>> 0) {
        var $_0 = $sp_0;
        break;
      }
    }
    var $12 = HEAPU32[$sp_0$s2 + 2];
    if (($12 | 0) == 0) {
      var $_0 = 0;
      break;
    }
    var $sp_0 = $12, $sp_0$s2 = $sp_0 >> 2;
  }
  var $_0;
  return $_0;
  return null;
}

function _init_top($p, $psize) {
  var $1 = $p;
  var $3 = $p + 8 | 0;
  if (($3 & 7 | 0) == 0) {
    var $10 = 0;
  } else {
    var $10 = -$3 & 7;
  }
  var $10;
  var $13 = $psize - $10 | 0;
  HEAP32[__gm_ + 24 >> 2] = $1 + $10 | 0;
  HEAP32[__gm_ + 12 >> 2] = $13;
  HEAP32[$10 + ($1 + 4) >> 2] = $13 | 1;
  HEAP32[$psize + ($1 + 4) >> 2] = 40;
  var $19 = HEAP32[_mparams + 16 >> 2];
  HEAP32[__gm_ + 28 >> 2] = $19;
  return;
  return;
}

function _init_bins() {
  var $i_02 = 0;
  while (1) {
    var $i_02;
    var $2 = $i_02 << 1;
    var $4 = ($2 << 2) + __gm_ + 40 | 0;
    HEAP32[__gm_ + ($2 + 3 << 2) + 40 >> 2] = $4;
    HEAP32[__gm_ + ($2 + 2 << 2) + 40 >> 2] = $4;
    var $7 = $i_02 + 1 | 0;
    if (($7 | 0) == 32) {
      break;
    }
    var $i_02 = $7;
  }
  return;
  return;
}

function _prepend_alloc($newbase, $oldbase, $nb) {
  var $R_1$s2;
  var $_sum$s2;
  var $19$s2;
  var $oldbase$s2 = $oldbase >> 2;
  var $newbase$s2 = $newbase >> 2;
  var __label__;
  var $2 = $newbase + 8 | 0;
  if (($2 & 7 | 0) == 0) {
    var $9 = 0;
  } else {
    var $9 = -$2 & 7;
  }
  var $9;
  var $12 = $oldbase + 8 | 0;
  if (($12 & 7 | 0) == 0) {
    var $19 = 0, $19$s2 = $19 >> 2;
  } else {
    var $19 = -$12 & 7, $19$s2 = $19 >> 2;
  }
  var $19;
  var $20 = $oldbase + $19 | 0;
  var $21 = $20;
  var $_sum = $9 + $nb | 0, $_sum$s2 = $_sum >> 2;
  var $25 = $newbase + $_sum | 0;
  var $26 = $25;
  var $27 = $20 - ($newbase + $9) - $nb | 0;
  HEAP32[($9 + 4 >> 2) + $newbase$s2] = $nb | 3;
  var $32 = ($21 | 0) == (HEAP32[__gm_ + 24 >> 2] | 0);
  $_$23 : do {
    if ($32) {
      var $35 = HEAP32[__gm_ + 12 >> 2] + $27 | 0;
      HEAP32[__gm_ + 12 >> 2] = $35;
      HEAP32[__gm_ + 24 >> 2] = $26;
      var $36 = $35 | 1;
      HEAP32[$_sum$s2 + ($newbase$s2 + 1)] = $36;
    } else {
      if (($21 | 0) == (HEAP32[__gm_ + 20 >> 2] | 0)) {
        var $44 = HEAP32[__gm_ + 8 >> 2] + $27 | 0;
        HEAP32[__gm_ + 8 >> 2] = $44;
        HEAP32[__gm_ + 20 >> 2] = $26;
        var $45 = $44 | 1;
        HEAP32[$_sum$s2 + ($newbase$s2 + 1)] = $45;
        var $49 = $newbase + $44 + $_sum | 0;
        HEAP32[$49 >> 2] = $44;
      } else {
        var $53 = HEAPU32[$19$s2 + ($oldbase$s2 + 1)];
        if (($53 & 3 | 0) == 1) {
          var $57 = $53 & -8;
          var $58 = $53 >>> 3;
          var $59 = $53 >>> 0 < 256;
          $_$31 : do {
            if ($59) {
              var $63 = HEAPU32[(($19 | 8) >> 2) + $oldbase$s2];
              var $66 = HEAPU32[$19$s2 + ($oldbase$s2 + 3)];
              if (($63 | 0) == ($66 | 0)) {
                var $72 = HEAP32[__gm_ >> 2] & (1 << $58 ^ -1);
                HEAP32[__gm_ >> 2] = $72;
              } else {
                var $77 = (($53 >>> 2 & 1073741822) << 2) + __gm_ + 40 | 0;
                var $78 = ($63 | 0) == ($77 | 0);
                do {
                  if ($78) {
                    __label__ = 16;
                  } else {
                    if ($63 >>> 0 < HEAPU32[__gm_ + 16 >> 2] >>> 0) {
                      __label__ = 19;
                      break;
                    }
                    __label__ = 16;
                    break;
                  }
                } while (0);
                do {
                  if (__label__ == 16) {
                    if (($66 | 0) != ($77 | 0)) {
                      if ($66 >>> 0 < HEAPU32[__gm_ + 16 >> 2] >>> 0) {
                        break;
                      }
                    }
                    HEAP32[$63 + 12 >> 2] = $66;
                    HEAP32[$66 + 8 >> 2] = $63;
                    break $_$31;
                  }
                } while (0);
                _abort();
                throw "Reached an unreachable!";
              }
            } else {
              var $92 = $20;
              var $95 = HEAPU32[(($19 | 24) >> 2) + $oldbase$s2];
              var $98 = HEAPU32[$19$s2 + ($oldbase$s2 + 3)];
              var $99 = ($98 | 0) == ($92 | 0);
              do {
                if ($99) {
                  var $_sum67 = $19 | 16;
                  var $113 = $_sum67 + ($oldbase + 4) | 0;
                  var $114 = HEAP32[$113 >> 2];
                  if (($114 | 0) == 0) {
                    var $118 = $oldbase + $_sum67 | 0;
                    var $119 = HEAP32[$118 >> 2];
                    if (($119 | 0) == 0) {
                      var $R_1 = 0, $R_1$s2 = $R_1 >> 2;
                      break;
                    }
                    var $RP_0 = $118;
                    var $R_0 = $119;
                  } else {
                    var $RP_0 = $113;
                    var $R_0 = $114;
                    __label__ = 26;
                  }
                  while (1) {
                    var $R_0;
                    var $RP_0;
                    var $121 = $R_0 + 20 | 0;
                    var $122 = HEAP32[$121 >> 2];
                    if (($122 | 0) != 0) {
                      var $RP_0 = $121;
                      var $R_0 = $122;
                      continue;
                    }
                    var $125 = $R_0 + 16 | 0;
                    var $126 = HEAPU32[$125 >> 2];
                    if (($126 | 0) == 0) {
                      break;
                    }
                    var $RP_0 = $125;
                    var $R_0 = $126;
                  }
                  if ($RP_0 >>> 0 < HEAPU32[__gm_ + 16 >> 2] >>> 0) {
                    _abort();
                    throw "Reached an unreachable!";
                  } else {
                    HEAP32[$RP_0 >> 2] = 0;
                    var $R_1 = $R_0, $R_1$s2 = $R_1 >> 2;
                  }
                } else {
                  var $103 = HEAPU32[(($19 | 8) >> 2) + $oldbase$s2];
                  if ($103 >>> 0 < HEAPU32[__gm_ + 16 >> 2] >>> 0) {
                    _abort();
                    throw "Reached an unreachable!";
                  } else {
                    HEAP32[$103 + 12 >> 2] = $98;
                    HEAP32[$98 + 8 >> 2] = $103;
                    var $R_1 = $98, $R_1$s2 = $R_1 >> 2;
                  }
                }
              } while (0);
              var $R_1;
              if (($95 | 0) == 0) {
                break;
              }
              var $138 = $19 + ($oldbase + 28) | 0;
              var $140 = (HEAP32[$138 >> 2] << 2) + __gm_ + 304 | 0;
              var $142 = ($92 | 0) == (HEAP32[$140 >> 2] | 0);
              do {
                if ($142) {
                  HEAP32[$140 >> 2] = $R_1;
                  if (($R_1 | 0) != 0) {
                    break;
                  }
                  var $148 = HEAP32[__gm_ + 4 >> 2] & (1 << HEAP32[$138 >> 2] ^ -1);
                  HEAP32[__gm_ + 4 >> 2] = $148;
                  break $_$31;
                }
                if ($95 >>> 0 < HEAPU32[__gm_ + 16 >> 2] >>> 0) {
                  _abort();
                  throw "Reached an unreachable!";
                } else {
                  var $154 = $95 + 16 | 0;
                  if ((HEAP32[$154 >> 2] | 0) == ($92 | 0)) {
                    HEAP32[$154 >> 2] = $R_1;
                  } else {
                    HEAP32[$95 + 20 >> 2] = $R_1;
                  }
                  if (($R_1 | 0) == 0) {
                    break $_$31;
                  }
                }
              } while (0);
              if ($R_1 >>> 0 < HEAPU32[__gm_ + 16 >> 2] >>> 0) {
                _abort();
                throw "Reached an unreachable!";
              } else {
                HEAP32[$R_1$s2 + 6] = $95;
                var $_sum3132 = $19 | 16;
                var $171 = HEAPU32[($_sum3132 >> 2) + $oldbase$s2];
                if (($171 | 0) != 0) {
                  if ($171 >>> 0 < HEAPU32[__gm_ + 16 >> 2] >>> 0) {
                    _abort();
                    throw "Reached an unreachable!";
                  } else {
                    HEAP32[$R_1$s2 + 4] = $171;
                    HEAP32[$171 + 24 >> 2] = $R_1;
                  }
                }
                var $184 = HEAPU32[($_sum3132 + 4 >> 2) + $oldbase$s2];
                if (($184 | 0) == 0) {
                  break;
                }
                if ($184 >>> 0 < HEAPU32[__gm_ + 16 >> 2] >>> 0) {
                  _abort();
                  throw "Reached an unreachable!";
                } else {
                  HEAP32[$R_1$s2 + 5] = $184;
                  HEAP32[$184 + 24 >> 2] = $R_1;
                }
              }
            }
          } while (0);
          var $oldfirst_0 = $oldbase + ($57 | $19) | 0;
          var $qsize_0 = $57 + $27 | 0;
        } else {
          var $oldfirst_0 = $21;
          var $qsize_0 = $27;
        }
        var $qsize_0;
        var $oldfirst_0;
        var $200 = $oldfirst_0 + 4 | 0;
        var $202 = HEAP32[$200 >> 2] & -2;
        HEAP32[$200 >> 2] = $202;
        HEAP32[$_sum$s2 + ($newbase$s2 + 1)] = $qsize_0 | 1;
        HEAP32[($qsize_0 >> 2) + $newbase$s2 + $_sum$s2] = $qsize_0;
        if ($qsize_0 >>> 0 < 256) {
          var $212 = $qsize_0 >>> 2 & 1073741822;
          var $214 = ($212 << 2) + __gm_ + 40 | 0;
          var $215 = HEAPU32[__gm_ >> 2];
          var $216 = 1 << ($qsize_0 >>> 3);
          var $218 = ($215 & $216 | 0) == 0;
          do {
            if ($218) {
              HEAP32[__gm_ >> 2] = $215 | $216;
              var $F4_0 = $214;
              var $_pre_phi = ($212 + 2 << 2) + __gm_ + 40 | 0;
            } else {
              var $222 = ($212 + 2 << 2) + __gm_ + 40 | 0;
              var $223 = HEAPU32[$222 >> 2];
              if ($223 >>> 0 >= HEAPU32[__gm_ + 16 >> 2] >>> 0) {
                var $F4_0 = $223;
                var $_pre_phi = $222;
                break;
              }
              _abort();
              throw "Reached an unreachable!";
            }
          } while (0);
          var $_pre_phi;
          var $F4_0;
          HEAP32[$_pre_phi >> 2] = $26;
          HEAP32[$F4_0 + 12 >> 2] = $26;
          HEAP32[$_sum$s2 + ($newbase$s2 + 2)] = $F4_0;
          HEAP32[$_sum$s2 + ($newbase$s2 + 3)] = $214;
        } else {
          var $235 = $25;
          var $236 = $qsize_0 >>> 8;
          var $237 = ($236 | 0) == 0;
          do {
            if ($237) {
              var $I7_0 = 0;
            } else {
              if ($qsize_0 >>> 0 > 16777215) {
                var $I7_0 = 31;
                break;
              }
              var $243 = ($236 + 1048320 | 0) >>> 16 & 8;
              var $244 = $236 << $243;
              var $247 = ($244 + 520192 | 0) >>> 16 & 4;
              var $248 = $244 << $247;
              var $251 = ($248 + 245760 | 0) >>> 16 & 2;
              var $257 = 14 - ($247 | $243 | $251) + ($248 << $251 >>> 15) | 0;
              var $I7_0 = $qsize_0 >>> (($257 + 7 | 0) >>> 0) & 1 | $257 << 1;
            }
          } while (0);
          var $I7_0;
          var $264 = ($I7_0 << 2) + __gm_ + 304 | 0;
          HEAP32[$_sum$s2 + ($newbase$s2 + 7)] = $I7_0;
          var $267 = $_sum + ($newbase + 16) | 0;
          HEAP32[$_sum$s2 + ($newbase$s2 + 5)] = 0;
          HEAP32[$267 >> 2] = 0;
          var $271 = HEAP32[__gm_ + 4 >> 2];
          var $272 = 1 << $I7_0;
          if (($271 & $272 | 0) == 0) {
            var $276 = $271 | $272;
            HEAP32[__gm_ + 4 >> 2] = $276;
            HEAP32[$264 >> 2] = $235;
            HEAP32[$_sum$s2 + ($newbase$s2 + 6)] = $264;
            HEAP32[$_sum$s2 + ($newbase$s2 + 3)] = $235;
            HEAP32[$_sum$s2 + ($newbase$s2 + 2)] = $235;
          } else {
            if (($I7_0 | 0) == 31) {
              var $291 = 0;
            } else {
              var $291 = 25 - ($I7_0 >>> 1) | 0;
            }
            var $291;
            var $K8_0 = $qsize_0 << $291;
            var $T_0 = HEAP32[$264 >> 2];
            while (1) {
              var $T_0;
              var $K8_0;
              if ((HEAP32[$T_0 + 4 >> 2] & -8 | 0) == ($qsize_0 | 0)) {
                var $317 = $T_0 + 8 | 0;
                var $318 = HEAPU32[$317 >> 2];
                var $320 = HEAPU32[__gm_ + 16 >> 2];
                var $321 = $T_0 >>> 0 < $320 >>> 0;
                do {
                  if (!$321) {
                    if ($318 >>> 0 < $320 >>> 0) {
                      break;
                    }
                    HEAP32[$318 + 12 >> 2] = $235;
                    HEAP32[$317 >> 2] = $235;
                    HEAP32[$_sum$s2 + ($newbase$s2 + 2)] = $318;
                    HEAP32[$_sum$s2 + ($newbase$s2 + 3)] = $T_0;
                    HEAP32[$_sum$s2 + ($newbase$s2 + 6)] = 0;
                    break $_$23;
                  }
                } while (0);
                _abort();
                throw "Reached an unreachable!";
              } else {
                var $300 = ($K8_0 >>> 31 << 2) + $T_0 + 16 | 0;
                var $301 = HEAPU32[$300 >> 2];
                if (($301 | 0) != 0) {
                  var $K8_0 = $K8_0 << 1;
                  var $T_0 = $301;
                  continue;
                }
                if ($300 >>> 0 >= HEAPU32[__gm_ + 16 >> 2] >>> 0) {
                  HEAP32[$300 >> 2] = $235;
                  HEAP32[$_sum$s2 + ($newbase$s2 + 6)] = $T_0;
                  HEAP32[$_sum$s2 + ($newbase$s2 + 3)] = $235;
                  HEAP32[$_sum$s2 + ($newbase$s2 + 2)] = $235;
                  break $_$23;
                }
                _abort();
                throw "Reached an unreachable!";
              }
            }
          }
        }
      }
    }
  } while (0);
  return $newbase + ($9 | 8) | 0;
  return null;
}

_prepend_alloc["X"] = 1;

function _add_segment($tbase, $tsize) {
  var $23$s2;
  var $1$s2;
  var $1 = HEAPU32[__gm_ + 24 >> 2], $1$s2 = $1 >> 2;
  var $2 = $1;
  var $3 = _segment_holding($2);
  var $5 = HEAP32[$3 >> 2];
  var $7 = HEAP32[$3 + 4 >> 2];
  var $8 = $5 + $7 | 0;
  var $10 = $5 + ($7 - 39) | 0;
  if (($10 & 7 | 0) == 0) {
    var $17 = 0;
  } else {
    var $17 = -$10 & 7;
  }
  var $17;
  var $18 = $5 + ($7 - 47) + $17 | 0;
  var $22 = $18 >>> 0 < ($1 + 16 | 0) >>> 0 ? $2 : $18;
  var $23 = $22 + 8 | 0, $23$s2 = $23 >> 2;
  var $24 = $23;
  var $25 = $tbase;
  var $26 = $tsize - 40 | 0;
  _init_top($25, $26);
  var $28 = $22 + 4 | 0;
  HEAP32[$28 >> 2] = 27;
  assert(16 % 1 === 0, "memcpy given " + 16 + " bytes to copy. Problem with quantum=1 corrections perhaps?");
  HEAP32[$23$s2] = HEAP32[__gm_ + 444 >> 2];
  HEAP32[$23$s2 + 1] = HEAP32[__gm_ + 448 >> 2];
  HEAP32[$23$s2 + 2] = HEAP32[__gm_ + 452 >> 2];
  HEAP32[$23$s2 + 3] = HEAP32[__gm_ + 456 >> 2];
  HEAP32[__gm_ + 444 >> 2] = $tbase;
  HEAP32[__gm_ + 448 >> 2] = $tsize;
  HEAP32[__gm_ + 456 >> 2] = 0;
  HEAP32[__gm_ + 452 >> 2] = $24;
  var $30 = $22 + 28 | 0;
  HEAP32[$30 >> 2] = 7;
  var $32 = ($22 + 32 | 0) >>> 0 < $8 >>> 0;
  $_$125 : do {
    if ($32) {
      var $33 = $30;
      while (1) {
        var $33;
        var $34 = $33 + 4 | 0;
        HEAP32[$34 >> 2] = 7;
        if (($33 + 8 | 0) >>> 0 >= $8 >>> 0) {
          break $_$125;
        }
        var $33 = $34;
      }
    }
  } while (0);
  var $38 = ($22 | 0) == ($2 | 0);
  $_$129 : do {
    if (!$38) {
      var $42 = $22 - $1 | 0;
      var $43 = $2 + $42 | 0;
      var $45 = $42 + ($2 + 4) | 0;
      var $47 = HEAP32[$45 >> 2] & -2;
      HEAP32[$45 >> 2] = $47;
      var $48 = $42 | 1;
      HEAP32[$1$s2 + 1] = $48;
      var $50 = $43;
      HEAP32[$50 >> 2] = $42;
      if ($42 >>> 0 < 256) {
        var $55 = $42 >>> 2 & 1073741822;
        var $57 = ($55 << 2) + __gm_ + 40 | 0;
        var $58 = HEAPU32[__gm_ >> 2];
        var $59 = 1 << ($42 >>> 3);
        var $61 = ($58 & $59 | 0) == 0;
        do {
          if ($61) {
            var $63 = $58 | $59;
            HEAP32[__gm_ >> 2] = $63;
            var $F_0 = $57;
            var $_pre_phi = ($55 + 2 << 2) + __gm_ + 40 | 0;
          } else {
            var $65 = ($55 + 2 << 2) + __gm_ + 40 | 0;
            var $66 = HEAPU32[$65 >> 2];
            if ($66 >>> 0 >= HEAPU32[__gm_ + 16 >> 2] >>> 0) {
              var $F_0 = $66;
              var $_pre_phi = $65;
              break;
            }
            _abort();
            throw "Reached an unreachable!";
          }
        } while (0);
        var $_pre_phi;
        var $F_0;
        HEAP32[$_pre_phi >> 2] = $1;
        HEAP32[$F_0 + 12 >> 2] = $1;
        HEAP32[$1$s2 + 2] = $F_0;
        HEAP32[$1$s2 + 3] = $57;
      } else {
        var $76 = $1;
        var $77 = $42 >>> 8;
        var $78 = ($77 | 0) == 0;
        do {
          if ($78) {
            var $I1_0 = 0;
          } else {
            if ($42 >>> 0 > 16777215) {
              var $I1_0 = 31;
              break;
            }
            var $84 = ($77 + 1048320 | 0) >>> 16 & 8;
            var $85 = $77 << $84;
            var $88 = ($85 + 520192 | 0) >>> 16 & 4;
            var $89 = $85 << $88;
            var $92 = ($89 + 245760 | 0) >>> 16 & 2;
            var $98 = 14 - ($88 | $84 | $92) + ($89 << $92 >>> 15) | 0;
            var $I1_0 = $42 >>> (($98 + 7 | 0) >>> 0) & 1 | $98 << 1;
          }
        } while (0);
        var $I1_0;
        var $105 = ($I1_0 << 2) + __gm_ + 304 | 0;
        HEAP32[$1$s2 + 7] = $I1_0;
        HEAP32[$1$s2 + 5] = 0;
        HEAP32[$1$s2 + 4] = 0;
        var $109 = HEAP32[__gm_ + 4 >> 2];
        var $110 = 1 << $I1_0;
        if (($109 & $110 | 0) == 0) {
          var $114 = $109 | $110;
          HEAP32[__gm_ + 4 >> 2] = $114;
          HEAP32[$105 >> 2] = $76;
          HEAP32[$1$s2 + 6] = $105;
          HEAP32[$1$s2 + 3] = $1;
          HEAP32[$1$s2 + 2] = $1;
        } else {
          if (($I1_0 | 0) == 31) {
            var $125 = 0;
          } else {
            var $125 = 25 - ($I1_0 >>> 1) | 0;
          }
          var $125;
          var $K2_0 = $42 << $125;
          var $T_0 = HEAP32[$105 >> 2];
          while (1) {
            var $T_0;
            var $K2_0;
            if ((HEAP32[$T_0 + 4 >> 2] & -8 | 0) == ($42 | 0)) {
              var $148 = $T_0 + 8 | 0;
              var $149 = HEAPU32[$148 >> 2];
              var $151 = HEAPU32[__gm_ + 16 >> 2];
              var $152 = $T_0 >>> 0 < $151 >>> 0;
              do {
                if (!$152) {
                  if ($149 >>> 0 < $151 >>> 0) {
                    break;
                  }
                  HEAP32[$149 + 12 >> 2] = $76;
                  HEAP32[$148 >> 2] = $76;
                  HEAP32[$1$s2 + 2] = $149;
                  HEAP32[$1$s2 + 3] = $T_0;
                  HEAP32[$1$s2 + 6] = 0;
                  break $_$129;
                }
              } while (0);
              _abort();
              throw "Reached an unreachable!";
            } else {
              var $134 = ($K2_0 >>> 31 << 2) + $T_0 + 16 | 0;
              var $135 = HEAPU32[$134 >> 2];
              if (($135 | 0) != 0) {
                var $K2_0 = $K2_0 << 1;
                var $T_0 = $135;
                continue;
              }
              if ($134 >>> 0 >= HEAPU32[__gm_ + 16 >> 2] >>> 0) {
                HEAP32[$134 >> 2] = $76;
                HEAP32[$1$s2 + 6] = $T_0;
                HEAP32[$1$s2 + 3] = $1;
                HEAP32[$1$s2 + 2] = $1;
                break $_$129;
              }
              _abort();
              throw "Reached an unreachable!";
            }
          }
        }
      }
    }
  } while (0);
  return;
  return;
}

_add_segment["X"] = 1;

function __ZNKSt9bad_alloc4whatEv($this) {
  return STRING_TABLE.__str366 | 0;
  return null;
}

function __ZNKSt20bad_array_new_length4whatEv($this) {
  return STRING_TABLE.__str1467 | 0;
  return null;
}

function __ZSt15get_new_handlerv() {
  var $1 = (tempValue = HEAP32[__ZL13__new_handler >> 2], HEAP32[__ZL13__new_handler >> 2] = tempValue, tempValue);
  return $1;
  return null;
}

function __ZSt15set_new_handlerPFvvE($handler) {
  var $1 = $handler;
  var $2 = (tempValue = HEAP32[__ZL13__new_handler >> 2], HEAP32[__ZL13__new_handler >> 2] = $1, tempValue);
  return $2;
  return null;
}

function __ZNSt9bad_allocC2Ev($this) {
  HEAP32[$this >> 2] = __ZTVSt9bad_alloc + 8 | 0;
  return;
  return;
}

function __ZdlPv($ptr) {
  if (($ptr | 0) != 0) {
    _free($ptr);
  }
  return;
  return;
}

function __ZdlPvRKSt9nothrow_t($ptr, $0) {
  __ZdlPv($ptr);
  return;
  return;
}

function __ZdaPv($ptr) {
  __ZdlPv($ptr);
  return;
  return;
}

function __ZdaPvRKSt9nothrow_t($ptr, $0) {
  __ZdaPv($ptr);
  return;
  return;
}

function __ZNSt9bad_allocD0Ev($this) {
  __ZNSt9bad_allocD2Ev($this);
  var $1 = $this;
  __ZdlPv($1);
  return;
  return;
}

function __ZNSt9bad_allocD2Ev($this) {
  var $1 = $this | 0;
  __ZNSt9exceptionD2Ev($1);
  return;
  return;
}

function __ZNSt20bad_array_new_lengthC2Ev($this) {
  var $1 = $this | 0;
  __ZNSt9bad_allocC2Ev($1);
  HEAP32[$this >> 2] = __ZTVSt20bad_array_new_length + 8 | 0;
  return;
  return;
}

function __ZNSt20bad_array_new_lengthD0Ev($this) {
  var $1 = $this | 0;
  __ZNSt9bad_allocD2Ev($1);
  var $2 = $this;
  __ZdlPv($2);
  return;
  return;
}

function __Znwj($size) {
  var $_size = ($size | 0) == 0 ? 1 : $size;
  while (1) {
    var $3 = _malloc($_size);
    if (($3 | 0) == 0) {
      var $6 = __ZSt15get_new_handlerv();
      if (($6 | 0) == 0) {
        var $15 = ___cxa_allocate_exception(4);
        var $16 = $15;
        __ZNSt9bad_allocC2Ev($16);
        ___cxa_throw($15, __ZTISt9bad_alloc, 2);
        throw "Reached an unreachable!";
      } else {
        FUNCTION_TABLE[$6]();
      }
    } else {
      return $3;
    }
  }
  return null;
}

function __ZnwjRKSt9nothrow_t($size, $0) {
  var $2 = __Znwj($size);
  var $p_0 = $2;
  var $p_0;
  return $p_0;
  return null;
}

function __Znaj($size) {
  var $1 = __Znwj($size);
  return $1;
  return null;
}

function __ZnajRKSt9nothrow_t($size, $nothrow) {
  var $1 = __Znaj($size);
  var $p_0 = $1;
  var $p_0;
  return $p_0;
  return null;
}

function __ZSt17__throw_bad_allocv() {
  var $1 = ___cxa_allocate_exception(4);
  var $2 = $1;
  __ZNSt9bad_allocC2Ev($2);
  ___cxa_throw($1, __ZTISt9bad_alloc, 2);
  throw "Reached an unreachable!";
}

var i64Math = null;

var _llvm_dbg_declare;

function _strlen(ptr) {
  return String_len(ptr);
}

function _strcpy(pdest, psrc) {
  var i = 0;
  do {
    HEAP8[pdest + i] = HEAP8[psrc + i];
    i++;
  } while (HEAP8[psrc + (i - 1)] != 0);
  return pdest;
}

function _tolower(chr) {
  if (chr >= "A".charCodeAt(0) && chr <= "Z".charCodeAt(0)) {
    return chr - "A".charCodeAt(0) + "a".charCodeAt(0);
  } else {
    return chr;
  }
}

function _strncasecmp(px, py, n) {
  var i = 0;
  while (i < n) {
    var x = _tolower(HEAP8[px + i]);
    var y = _tolower(HEAP8[py + i]);
    if (x == y && x == 0) return 0;
    if (x == 0) return -1;
    if (y == 0) return 1;
    if (x == y) {
      i++;
      continue;
    } else {
      return x > y ? 1 : -1;
    }
  }
  return 0;
}

function ___assert_func(filename, line, func, condition) {
  throw "Assertion failed: " + Pointer_stringify(condition) + ", at: " + [ Pointer_stringify(filename), line, Pointer_stringify(func) ];
}

function _memcpy(dest, src, num, align) {
  assert(num % 1 === 0, "memcpy given " + num + " bytes to copy. Problem with quantum=1 corrections perhaps?");
  if (num >= 20 && src % 2 == dest % 2) {
    if (src % 4 == dest % 4) {
      var stop = src + num;
      while (src % 4) {
        HEAP8[dest++] = HEAP8[src++];
      }
      var src4 = src >> 2, dest4 = dest >> 2, stop4 = stop >> 2;
      while (src4 < stop4) {
        HEAP32[dest4++] = HEAP32[src4++];
      }
      src = src4 << 2;
      dest = dest4 << 2;
      while (src < stop) {
        HEAP8[dest++] = HEAP8[src++];
      }
    } else {
      var stop = src + num;
      if (src % 2) {
        HEAP8[dest++] = HEAP8[src++];
      }
      var src2 = src >> 1, dest2 = dest >> 1, stop2 = stop >> 1;
      while (src2 < stop2) {
        HEAP16[dest2++] = HEAP16[src2++];
      }
      src = src2 << 1;
      dest = dest2 << 1;
      if (src < stop) {
        HEAP8[dest++] = HEAP8[src++];
      }
    }
  } else {
    while (num--) {
      HEAP8[dest++] = HEAP8[src++];
    }
  }
}

var _llvm_memcpy_p0i8_p0i8_i32 = _memcpy;

function _memset(ptr, value, num, align) {
  if (num >= 20) {
    var stop = ptr + num;
    while (ptr % 4) {
      HEAP8[ptr++] = value;
    }
    if (value < 0) value += 256;
    var ptr4 = ptr >> 2, stop4 = stop >> 2, value4 = value | value << 8 | value << 16 | value << 24;
    while (ptr4 < stop4) {
      HEAP32[ptr4++] = value4;
    }
    ptr = ptr4 << 2;
    while (ptr < stop) {
      HEAP8[ptr++] = value;
    }
  } else {
    while (num--) {
      HEAP8[ptr++] = value;
    }
  }
}

var _llvm_memset_p0i8_i32 = _memset;

function _memcmp(p1, p2, num) {
  for (var i = 0; i < num; i++) {
    var v1 = HEAP8[p1 + i];
    var v2 = HEAP8[p2 + i];
    if (v1 != v2) return v1 > v2 ? 1 : -1;
  }
  return 0;
}

function _isalnum(chr) {
  return chr >= "0".charCodeAt(0) && chr <= "9".charCodeAt(0) || chr >= "a".charCodeAt(0) && chr <= "z".charCodeAt(0) || chr >= "A".charCodeAt(0) && chr <= "Z".charCodeAt(0);
}

function _ispunct(chr) {
  return chr >= "!".charCodeAt(0) && chr <= "/".charCodeAt(0) || chr >= ":".charCodeAt(0) && chr <= "@".charCodeAt(0) || chr >= "[".charCodeAt(0) && chr <= "`".charCodeAt(0) || chr >= "{".charCodeAt(0) && chr <= "~".charCodeAt(0);
}

function _memmove(dest, src, num, align) {
  if (src < dest && dest < src + num) {
    src += num;
    dest += num;
    while (num--) {
      dest--;
      src--;
      HEAP8[dest] = HEAP8[src];
    }
  } else {
    _memcpy(dest, src, num, align);
  }
}

var _llvm_memmove_p0i8_p0i8_i32 = _memmove;

function _strncmp(px, py, n) {
  var i = 0;
  while (i < n) {
    var x = HEAP8[px + i];
    var y = HEAP8[py + i];
    if (x == y && x == 0) return 0;
    if (x == 0) return -1;
    if (y == 0) return 1;
    if (x == y) {
      i++;
      continue;
    } else {
      return x > y ? 1 : -1;
    }
  }
  return 0;
}

function _strcmp(px, py) {
  return _strncmp(px, py, TOTAL_MEMORY);
}

var _llvm_va_start;

function __formatString(format, varargs) {
  var textIndex = format;
  var argIndex = 0;
  function getNextArg(type) {
    var ret;
    if (type === "double") {
      ret = (tempDoubleI32[0] = HEAP32[varargs + argIndex >> 2], tempDoubleI32[1] = HEAP32[varargs + (argIndex + 4) >> 2], tempDoubleF64[0]);
    } else if (type == "i64") {
      ret = [ HEAP32[varargs + argIndex >> 2], HEAP32[varargs + (argIndex + 4) >> 2] ];
    } else {
      type = "i32";
      ret = HEAP32[varargs + argIndex >> 2];
    }
    argIndex += Runtime.getNativeFieldSize(type);
    return ret;
  }
  var ret = [];
  var curr, next, currArg;
  while (1) {
    var startTextIndex = textIndex;
    curr = HEAP8[textIndex];
    if (curr === 0) break;
    next = HEAP8[textIndex + 1];
    if (curr == "%".charCodeAt(0)) {
      var flagAlwaysSigned = false;
      var flagLeftAlign = false;
      var flagAlternative = false;
      var flagZeroPad = false;
      flagsLoop : while (1) {
        switch (next) {
         case "+".charCodeAt(0):
          flagAlwaysSigned = true;
          break;
         case "-".charCodeAt(0):
          flagLeftAlign = true;
          break;
         case "#".charCodeAt(0):
          flagAlternative = true;
          break;
         case "0".charCodeAt(0):
          if (flagZeroPad) {
            break flagsLoop;
          } else {
            flagZeroPad = true;
            break;
          }
         default:
          break flagsLoop;
        }
        textIndex++;
        next = HEAP8[textIndex + 1];
      }
      var width = 0;
      if (next == "*".charCodeAt(0)) {
        width = getNextArg("i32");
        textIndex++;
        next = HEAP8[textIndex + 1];
      } else {
        while (next >= "0".charCodeAt(0) && next <= "9".charCodeAt(0)) {
          width = width * 10 + (next - "0".charCodeAt(0));
          textIndex++;
          next = HEAP8[textIndex + 1];
        }
      }
      var precisionSet = false;
      if (next == ".".charCodeAt(0)) {
        var precision = 0;
        precisionSet = true;
        textIndex++;
        next = HEAP8[textIndex + 1];
        if (next == "*".charCodeAt(0)) {
          precision = getNextArg("i32");
          textIndex++;
        } else {
          while (1) {
            var precisionChr = HEAP8[textIndex + 1];
            if (precisionChr < "0".charCodeAt(0) || precisionChr > "9".charCodeAt(0)) break;
            precision = precision * 10 + (precisionChr - "0".charCodeAt(0));
            textIndex++;
          }
        }
        next = HEAP8[textIndex + 1];
      } else {
        var precision = 6;
      }
      var argSize;
      switch (String.fromCharCode(next)) {
       case "h":
        var nextNext = HEAP8[textIndex + 2];
        if (nextNext == "h".charCodeAt(0)) {
          textIndex++;
          argSize = 1;
        } else {
          argSize = 2;
        }
        break;
       case "l":
        var nextNext = HEAP8[textIndex + 2];
        if (nextNext == "l".charCodeAt(0)) {
          textIndex++;
          argSize = 8;
        } else {
          argSize = 4;
        }
        break;
       case "L":
       case "q":
       case "j":
        argSize = 8;
        break;
       case "z":
       case "t":
       case "I":
        argSize = 4;
        break;
       default:
        argSize = null;
      }
      if (argSize) textIndex++;
      next = HEAP8[textIndex + 1];
      if ([ "d", "i", "u", "o", "x", "X", "p" ].indexOf(String.fromCharCode(next)) != -1) {
        var signed = next == "d".charCodeAt(0) || next == "i".charCodeAt(0);
        argSize = argSize || 4;
        var currArg = getNextArg("i" + argSize * 8);
        var origArg = currArg;
        var argText;
        if (argSize == 8) {
          currArg = Runtime.makeBigInt(currArg[0], currArg[1], next == "u".charCodeAt(0));
        }
        if (argSize <= 4) {
          var limit = Math.pow(256, argSize) - 1;
          currArg = (signed ? reSign : unSign)(currArg & limit, argSize * 8);
        }
        var currAbsArg = Math.abs(currArg);
        var prefix = "";
        if (next == "d".charCodeAt(0) || next == "i".charCodeAt(0)) {
          if (argSize == 8 && i64Math) argText = i64Math.stringify(origArg[0], origArg[1]); else argText = reSign(currArg, 8 * argSize, 1).toString(10);
        } else if (next == "u".charCodeAt(0)) {
          if (argSize == 8 && i64Math) argText = i64Math.stringify(origArg[0], origArg[1], true); else argText = unSign(currArg, 8 * argSize, 1).toString(10);
          currArg = Math.abs(currArg);
        } else if (next == "o".charCodeAt(0)) {
          argText = (flagAlternative ? "0" : "") + currAbsArg.toString(8);
        } else if (next == "x".charCodeAt(0) || next == "X".charCodeAt(0)) {
          prefix = flagAlternative ? "0x" : "";
          if (currArg < 0) {
            currArg = -currArg;
            argText = (currAbsArg - 1).toString(16);
            var buffer = [];
            for (var i = 0; i < argText.length; i++) {
              buffer.push((15 - parseInt(argText[i], 16)).toString(16));
            }
            argText = buffer.join("");
            while (argText.length < argSize * 2) argText = "f" + argText;
          } else {
            argText = currAbsArg.toString(16);
          }
          if (next == "X".charCodeAt(0)) {
            prefix = prefix.toUpperCase();
            argText = argText.toUpperCase();
          }
        } else if (next == "p".charCodeAt(0)) {
          if (currAbsArg === 0) {
            argText = "(nil)";
          } else {
            prefix = "0x";
            argText = currAbsArg.toString(16);
          }
        }
        if (precisionSet) {
          while (argText.length < precision) {
            argText = "0" + argText;
          }
        }
        if (flagAlwaysSigned) {
          if (currArg < 0) {
            prefix = "-" + prefix;
          } else {
            prefix = "+" + prefix;
          }
        }
        while (prefix.length + argText.length < width) {
          if (flagLeftAlign) {
            argText += " ";
          } else {
            if (flagZeroPad) {
              argText = "0" + argText;
            } else {
              prefix = " " + prefix;
            }
          }
        }
        argText = prefix + argText;
        argText.split("").forEach((function(chr) {
          ret.push(chr.charCodeAt(0));
        }));
      } else if ([ "f", "F", "e", "E", "g", "G" ].indexOf(String.fromCharCode(next)) != -1) {
        var currArg = getNextArg("double");
        var argText;
        if (isNaN(currArg)) {
          argText = "nan";
          flagZeroPad = false;
        } else if (!isFinite(currArg)) {
          argText = (currArg < 0 ? "-" : "") + "inf";
          flagZeroPad = false;
        } else {
          var isGeneral = false;
          var effectivePrecision = Math.min(precision, 20);
          if (next == "g".charCodeAt(0) || next == "G".charCodeAt(0)) {
            isGeneral = true;
            precision = precision || 1;
            var exponent = parseInt(currArg.toExponential(effectivePrecision).split("e")[1], 10);
            if (precision > exponent && exponent >= -4) {
              next = (next == "g".charCodeAt(0) ? "f" : "F").charCodeAt(0);
              precision -= exponent + 1;
            } else {
              next = (next == "g".charCodeAt(0) ? "e" : "E").charCodeAt(0);
              precision--;
            }
            effectivePrecision = Math.min(precision, 20);
          }
          if (next == "e".charCodeAt(0) || next == "E".charCodeAt(0)) {
            argText = currArg.toExponential(effectivePrecision);
            if (/[eE][-+]\d$/.test(argText)) {
              argText = argText.slice(0, -1) + "0" + argText.slice(-1);
            }
          } else if (next == "f".charCodeAt(0) || next == "F".charCodeAt(0)) {
            argText = currArg.toFixed(effectivePrecision);
          }
          var parts = argText.split("e");
          if (isGeneral && !flagAlternative) {
            while (parts[0].length > 1 && parts[0].indexOf(".") != -1 && (parts[0].slice(-1) == "0" || parts[0].slice(-1) == ".")) {
              parts[0] = parts[0].slice(0, -1);
            }
          } else {
            if (flagAlternative && argText.indexOf(".") == -1) parts[0] += ".";
            while (precision > effectivePrecision++) parts[0] += "0";
          }
          argText = parts[0] + (parts.length > 1 ? "e" + parts[1] : "");
          if (next == "E".charCodeAt(0)) argText = argText.toUpperCase();
          if (flagAlwaysSigned && currArg >= 0) {
            argText = "+" + argText;
          }
        }
        while (argText.length < width) {
          if (flagLeftAlign) {
            argText += " ";
          } else {
            if (flagZeroPad && (argText[0] == "-" || argText[0] == "+")) {
              argText = argText[0] + "0" + argText.slice(1);
            } else {
              argText = (flagZeroPad ? "0" : " ") + argText;
            }
          }
        }
        if (next < "a".charCodeAt(0)) argText = argText.toUpperCase();
        argText.split("").forEach((function(chr) {
          ret.push(chr.charCodeAt(0));
        }));
      } else if (next == "s".charCodeAt(0)) {
        var arg = getNextArg("i8*") || 0;
        var argLength = String_len(arg);
        if (precisionSet) argLength = Math.min(String_len(arg), precision);
        if (!flagLeftAlign) {
          while (argLength < width--) {
            ret.push(" ".charCodeAt(0));
          }
        }
        for (var i = 0; i < argLength; i++) {
          ret.push(HEAPU8[arg++]);
        }
        if (flagLeftAlign) {
          while (argLength < width--) {
            ret.push(" ".charCodeAt(0));
          }
        }
      } else if (next == "c".charCodeAt(0)) {
        if (flagLeftAlign) ret.push(getNextArg("i8"));
        while (--width > 0) {
          ret.push(" ".charCodeAt(0));
        }
        if (!flagLeftAlign) ret.push(getNextArg("i8"));
      } else if (next == "n".charCodeAt(0)) {
        var ptr = getNextArg("i32*");
        HEAP32[ptr >> 2] = ret.length;
      } else if (next == "%".charCodeAt(0)) {
        ret.push(curr);
      } else {
        for (var i = startTextIndex; i < textIndex + 2; i++) {
          ret.push(HEAP8[i]);
        }
      }
      textIndex += 2;
    } else {
      ret.push(curr);
      textIndex += 1;
    }
  }
  return ret;
}

function _snprintf(s, n, format, varargs) {
  var result = __formatString(format, varargs);
  var limit = n === undefined ? result.length : Math.min(result.length, n - 1);
  for (var i = 0; i < limit; i++) {
    HEAP8[s + i] = result[i];
  }
  HEAP8[s + i] = 0;
  return result.length;
}

var _vsnprintf = _snprintf;

function _llvm_va_end() {}

function _isspace(chr) {
  return chr in {
    32: 0,
    9: 0,
    10: 0,
    11: 0,
    12: 0,
    13: 0
  };
}

function _isalpha(chr) {
  return chr >= "a".charCodeAt(0) && chr <= "z".charCodeAt(0) || chr >= "A".charCodeAt(0) && chr <= "Z".charCodeAt(0);
}

function _abort() {
  ABORT = true;
  throw "abort() at " + (new Error).stack;
}

var ERRNO_CODES = {
  E2BIG: 7,
  EACCES: 13,
  EADDRINUSE: 98,
  EADDRNOTAVAIL: 99,
  EAFNOSUPPORT: 97,
  EAGAIN: 11,
  EALREADY: 114,
  EBADF: 9,
  EBADMSG: 74,
  EBUSY: 16,
  ECANCELED: 125,
  ECHILD: 10,
  ECONNABORTED: 103,
  ECONNREFUSED: 111,
  ECONNRESET: 104,
  EDEADLK: 35,
  EDESTADDRREQ: 89,
  EDOM: 33,
  EDQUOT: 122,
  EEXIST: 17,
  EFAULT: 14,
  EFBIG: 27,
  EHOSTUNREACH: 113,
  EIDRM: 43,
  EILSEQ: 84,
  EINPROGRESS: 115,
  EINTR: 4,
  EINVAL: 22,
  EIO: 5,
  EISCONN: 106,
  EISDIR: 21,
  ELOOP: 40,
  EMFILE: 24,
  EMLINK: 31,
  EMSGSIZE: 90,
  EMULTIHOP: 72,
  ENAMETOOLONG: 36,
  ENETDOWN: 100,
  ENETRESET: 102,
  ENETUNREACH: 101,
  ENFILE: 23,
  ENOBUFS: 105,
  ENODATA: 61,
  ENODEV: 19,
  ENOENT: 2,
  ENOEXEC: 8,
  ENOLCK: 37,
  ENOLINK: 67,
  ENOMEM: 12,
  ENOMSG: 42,
  ENOPROTOOPT: 92,
  ENOSPC: 28,
  ENOSR: 63,
  ENOSTR: 60,
  ENOSYS: 38,
  ENOTCONN: 107,
  ENOTDIR: 20,
  ENOTEMPTY: 39,
  ENOTRECOVERABLE: 131,
  ENOTSOCK: 88,
  ENOTSUP: 95,
  ENOTTY: 25,
  ENXIO: 6,
  EOVERFLOW: 75,
  EOWNERDEAD: 130,
  EPERM: 1,
  EPIPE: 32,
  EPROTO: 71,
  EPROTONOSUPPORT: 93,
  EPROTOTYPE: 91,
  ERANGE: 34,
  EROFS: 30,
  ESPIPE: 29,
  ESRCH: 3,
  ESTALE: 116,
  ETIME: 62,
  ETIMEDOUT: 110,
  ETXTBSY: 26,
  EWOULDBLOCK: 11,
  EXDEV: 18
};

function ___setErrNo(value) {
  if (!___setErrNo.ret) ___setErrNo.ret = allocate([ 0 ], "i32", ALLOC_STATIC);
  HEAP32[___setErrNo.ret >> 2] = value;
  return value;
}

var _stdin = 0;

var _stdout = 0;

var _stderr = 0;

var __impure_ptr = 0;

var FS = {
  currentPath: "/",
  nextInode: 2,
  streams: [ null ],
  ignorePermissions: true,
  absolutePath: (function(relative, base) {
    if (typeof relative !== "string") return null;
    if (base === undefined) base = FS.currentPath;
    if (relative && relative[0] == "/") base = "";
    var full = base + "/" + relative;
    var parts = full.split("/").reverse();
    var absolute = [ "" ];
    while (parts.length) {
      var part = parts.pop();
      if (part == "" || part == ".") {} else if (part == "..") {
        if (absolute.length > 1) absolute.pop();
      } else {
        absolute.push(part);
      }
    }
    return absolute.length == 1 ? "/" : absolute.join("/");
  }),
  analyzePath: (function(path, dontResolveLastLink, linksVisited) {
    var ret = {
      isRoot: false,
      exists: false,
      error: 0,
      name: null,
      path: null,
      object: null,
      parentExists: false,
      parentPath: null,
      parentObject: null
    };
    path = FS.absolutePath(path);
    if (path == "/") {
      ret.isRoot = true;
      ret.exists = ret.parentExists = true;
      ret.name = "/";
      ret.path = ret.parentPath = "/";
      ret.object = ret.parentObject = FS.root;
    } else if (path !== null) {
      linksVisited = linksVisited || 0;
      path = path.slice(1).split("/");
      var current = FS.root;
      var traversed = [ "" ];
      while (path.length) {
        if (path.length == 1 && current.isFolder) {
          ret.parentExists = true;
          ret.parentPath = traversed.length == 1 ? "/" : traversed.join("/");
          ret.parentObject = current;
          ret.name = path[0];
        }
        var target = path.shift();
        if (!current.isFolder) {
          ret.error = ERRNO_CODES.ENOTDIR;
          break;
        } else if (!current.read) {
          ret.error = ERRNO_CODES.EACCES;
          break;
        } else if (!current.contents.hasOwnProperty(target)) {
          ret.error = ERRNO_CODES.ENOENT;
          break;
        }
        current = current.contents[target];
        if (current.link && !(dontResolveLastLink && path.length == 0)) {
          if (linksVisited > 40) {
            ret.error = ERRNO_CODES.ELOOP;
            break;
          }
          var link = FS.absolutePath(current.link, traversed.join("/"));
          ret = FS.analyzePath([ link ].concat(path).join("/"), dontResolveLastLink, linksVisited + 1);
          return ret;
        }
        traversed.push(target);
        if (path.length == 0) {
          ret.exists = true;
          ret.path = traversed.join("/");
          ret.object = current;
        }
      }
    }
    return ret;
  }),
  findObject: (function(path, dontResolveLastLink) {
    FS.ensureRoot();
    var ret = FS.analyzePath(path, dontResolveLastLink);
    if (ret.exists) {
      return ret.object;
    } else {
      ___setErrNo(ret.error);
      return null;
    }
  }),
  createObject: (function(parent, name, properties, canRead, canWrite) {
    if (!parent) parent = "/";
    if (typeof parent === "string") parent = FS.findObject(parent);
    if (!parent) {
      ___setErrNo(ERRNO_CODES.EACCES);
      throw new Error("Parent path must exist.");
    }
    if (!parent.isFolder) {
      ___setErrNo(ERRNO_CODES.ENOTDIR);
      throw new Error("Parent must be a folder.");
    }
    if (!parent.write && !FS.ignorePermissions) {
      ___setErrNo(ERRNO_CODES.EACCES);
      throw new Error("Parent folder must be writeable.");
    }
    if (!name || name == "." || name == "..") {
      ___setErrNo(ERRNO_CODES.ENOENT);
      throw new Error("Name must not be empty.");
    }
    if (parent.contents.hasOwnProperty(name)) {
      ___setErrNo(ERRNO_CODES.EEXIST);
      throw new Error("Can't overwrite object.");
    }
    parent.contents[name] = {
      read: canRead === undefined ? true : canRead,
      write: canWrite === undefined ? false : canWrite,
      timestamp: Date.now(),
      inodeNumber: FS.nextInode++
    };
    for (var key in properties) {
      if (properties.hasOwnProperty(key)) {
        parent.contents[name][key] = properties[key];
      }
    }
    return parent.contents[name];
  }),
  createFolder: (function(parent, name, canRead, canWrite) {
    var properties = {
      isFolder: true,
      isDevice: false,
      contents: {}
    };
    return FS.createObject(parent, name, properties, canRead, canWrite);
  }),
  createPath: (function(parent, path, canRead, canWrite) {
    var current = FS.findObject(parent);
    if (current === null) throw new Error("Invalid parent.");
    path = path.split("/").reverse();
    while (path.length) {
      var part = path.pop();
      if (!part) continue;
      if (!current.contents.hasOwnProperty(part)) {
        FS.createFolder(current, part, canRead, canWrite);
      }
      current = current.contents[part];
    }
    return current;
  }),
  createFile: (function(parent, name, properties, canRead, canWrite) {
    properties.isFolder = false;
    return FS.createObject(parent, name, properties, canRead, canWrite);
  }),
  createDataFile: (function(parent, name, data, canRead, canWrite) {
    if (typeof data === "string") {
      var dataArray = new Array(data.length);
      for (var i = 0, len = data.length; i < len; ++i) dataArray[i] = data.charCodeAt(i);
      data = dataArray;
    }
    var properties = {
      isDevice: false,
      contents: data
    };
    return FS.createFile(parent, name, properties, canRead, canWrite);
  }),
  createLazyFile: (function(parent, name, url, canRead, canWrite) {
    var properties = {
      isDevice: false,
      url: url
    };
    return FS.createFile(parent, name, properties, canRead, canWrite);
  }),
  createPreloadedFile: (function(parent, name, url, canRead, canWrite) {
    Browser.asyncLoad(url, (function(data) {
      FS.createDataFile(parent, name, data, canRead, canWrite);
    }));
  }),
  createLink: (function(parent, name, target, canRead, canWrite) {
    var properties = {
      isDevice: false,
      link: target
    };
    return FS.createFile(parent, name, properties, canRead, canWrite);
  }),
  createDevice: (function(parent, name, input, output) {
    if (!(input || output)) {
      throw new Error("A device must have at least one callback defined.");
    }
    var ops = {
      isDevice: true,
      input: input,
      output: output
    };
    return FS.createFile(parent, name, ops, Boolean(input), Boolean(output));
  }),
  forceLoadFile: (function(obj) {
    if (obj.isDevice || obj.isFolder || obj.link || obj.contents) return true;
    var success = true;
    if (typeof XMLHttpRequest !== "undefined") {
      assert("Cannot do synchronous binary XHRs in modern browsers. Use --embed-file or --preload-file in emcc");
    } else if (Module["read"]) {
      try {
        obj.contents = intArrayFromString(Module["read"](obj.url), true);
      } catch (e) {
        success = false;
      }
    } else {
      throw new Error("Cannot load without read() or XMLHttpRequest.");
    }
    if (!success) ___setErrNo(ERRNO_CODES.EIO);
    return success;
  }),
  ensureRoot: (function() {
    if (FS.root) return;
    FS.root = {
      read: true,
      write: true,
      isFolder: true,
      isDevice: false,
      timestamp: Date.now(),
      inodeNumber: 1,
      contents: {}
    };
  }),
  init: (function(input, output, error) {
    assert(!FS.init.initialized, "FS.init was previously called. If you want to initialize later with custom parameters, remove any earlier calls (note that one is automatically added to the generated code)");
    FS.init.initialized = true;
    FS.ensureRoot();
    input = input || Module["stdin"];
    output = output || Module["stdout"];
    error = error || Module["stderr"];
    var stdinOverridden = true, stdoutOverridden = true, stderrOverridden = true;
    if (!input) {
      stdinOverridden = false;
      input = (function() {
        if (!input.cache || !input.cache.length) {
          var result;
          if (typeof window != "undefined" && typeof window.prompt == "function") {
            result = window.prompt("Input: ");
            if (result === null) result = String.fromCharCode(0);
          } else if (typeof readline == "function") {
            result = readline();
          }
          if (!result) result = "";
          input.cache = intArrayFromString(result + "\n", true);
        }
        return input.cache.shift();
      });
    }
    function simpleOutput(val) {
      if (val === null || val === "\n".charCodeAt(0)) {
        output.printer(output.buffer.join(""));
        output.buffer = [];
      } else {
        output.buffer.push(String.fromCharCode(val));
      }
    }
    if (!output) {
      stdoutOverridden = false;
      output = simpleOutput;
    }
    if (!output.printer) output.printer = Module["print"];
    if (!output.buffer) output.buffer = [];
    if (!error) {
      stderrOverridden = false;
      error = simpleOutput;
    }
    if (!error.printer) error.printer = Module["print"];
    if (!error.buffer) error.buffer = [];
    try {
      FS.createFolder("/", "tmp", true, true);
    } catch (e) {}
    var devFolder = FS.createFolder("/", "dev", true, true);
    var stdin = FS.createDevice(devFolder, "stdin", input);
    var stdout = FS.createDevice(devFolder, "stdout", null, output);
    var stderr = FS.createDevice(devFolder, "stderr", null, error);
    FS.createDevice(devFolder, "tty", input, output);
    FS.streams[1] = {
      path: "/dev/stdin",
      object: stdin,
      position: 0,
      isRead: true,
      isWrite: false,
      isAppend: false,
      isTerminal: !stdinOverridden,
      error: false,
      eof: false,
      ungotten: []
    };
    FS.streams[2] = {
      path: "/dev/stdout",
      object: stdout,
      position: 0,
      isRead: false,
      isWrite: true,
      isAppend: false,
      isTerminal: !stdoutOverridden,
      error: false,
      eof: false,
      ungotten: []
    };
    FS.streams[3] = {
      path: "/dev/stderr",
      object: stderr,
      position: 0,
      isRead: false,
      isWrite: true,
      isAppend: false,
      isTerminal: !stderrOverridden,
      error: false,
      eof: false,
      ungotten: []
    };
    _stdin = allocate([ 1 ], "void*", ALLOC_STATIC);
    _stdout = allocate([ 2 ], "void*", ALLOC_STATIC);
    _stderr = allocate([ 3 ], "void*", ALLOC_STATIC);
    FS.createPath("/", "dev/shm/tmp", true, true);
    FS.streams[_stdin] = FS.streams[1];
    FS.streams[_stdout] = FS.streams[2];
    FS.streams[_stderr] = FS.streams[3];
    __impure_ptr = allocate([ allocate([ 0, 0, 0, 0, _stdin, 0, 0, 0, _stdout, 0, 0, 0, _stderr, 0, 0, 0 ], "void*", ALLOC_STATIC) ], "void*", ALLOC_STATIC);
  }),
  quit: (function() {
    if (!FS.init.initialized) return;
    if (FS.streams[2] && FS.streams[2].object.output.buffer.length > 0) FS.streams[2].object.output("\n".charCodeAt(0));
    if (FS.streams[3] && FS.streams[3].object.output.buffer.length > 0) FS.streams[3].object.output("\n".charCodeAt(0));
  }),
  standardizePath: (function(path) {
    if (path.substr(0, 2) == "./") path = path.substr(2);
    return path;
  }),
  deleteFile: (function(path) {
    var path = FS.analyzePath(path);
    if (!path.parentExists || !path.exists) {
      throw "Invalid path " + path;
    }
    delete path.parentObject.contents[path.name];
  })
};

function _pwrite(fildes, buf, nbyte, offset) {
  var stream = FS.streams[fildes];
  if (!stream || stream.object.isDevice) {
    ___setErrNo(ERRNO_CODES.EBADF);
    return -1;
  } else if (!stream.isWrite) {
    ___setErrNo(ERRNO_CODES.EACCES);
    return -1;
  } else if (stream.object.isFolder) {
    ___setErrNo(ERRNO_CODES.EISDIR);
    return -1;
  } else if (nbyte < 0 || offset < 0) {
    ___setErrNo(ERRNO_CODES.EINVAL);
    return -1;
  } else {
    var contents = stream.object.contents;
    while (contents.length < offset) contents.push(0);
    for (var i = 0; i < nbyte; i++) {
      contents[offset + i] = HEAPU8[buf + i];
    }
    stream.object.timestamp = Date.now();
    return i;
  }
}

function _write(fildes, buf, nbyte) {
  var stream = FS.streams[fildes];
  if (!stream) {
    ___setErrNo(ERRNO_CODES.EBADF);
    return -1;
  } else if (!stream.isWrite) {
    ___setErrNo(ERRNO_CODES.EACCES);
    return -1;
  } else if (nbyte < 0) {
    ___setErrNo(ERRNO_CODES.EINVAL);
    return -1;
  } else {
    if (stream.object.isDevice) {
      if (stream.object.output) {
        for (var i = 0; i < nbyte; i++) {
          try {
            stream.object.output(HEAP8[buf + i]);
          } catch (e) {
            ___setErrNo(ERRNO_CODES.EIO);
            return -1;
          }
        }
        stream.object.timestamp = Date.now();
        return i;
      } else {
        ___setErrNo(ERRNO_CODES.ENXIO);
        return -1;
      }
    } else {
      var bytesWritten = _pwrite(fildes, buf, nbyte, stream.position);
      if (bytesWritten != -1) stream.position += bytesWritten;
      return bytesWritten;
    }
  }
}

function _fwrite(ptr, size, nitems, stream) {
  var bytesToWrite = nitems * size;
  if (bytesToWrite == 0) return 0;
  var bytesWritten = _write(stream, ptr, bytesToWrite);
  if (bytesWritten == -1) {
    if (FS.streams[stream]) FS.streams[stream].error = true;
    return -1;
  } else {
    return Math.floor(bytesWritten / size);
  }
}

function _fprintf(stream, format, varargs) {
  var result = __formatString(format, varargs);
  var stack = Runtime.stackSave();
  var ret = _fwrite(allocate(result, "i8", ALLOC_STACK), 1, result.length, stream);
  Runtime.stackRestore(stack);
  return ret;
}

function _sysconf(name) {
  switch (name) {
   case 8:
    return PAGE_SIZE;
   case 54:
   case 56:
   case 21:
   case 61:
   case 63:
   case 22:
   case 67:
   case 23:
   case 24:
   case 25:
   case 26:
   case 27:
   case 69:
   case 28:
   case 101:
   case 70:
   case 71:
   case 29:
   case 30:
   case 199:
   case 75:
   case 76:
   case 32:
   case 43:
   case 44:
   case 80:
   case 46:
   case 47:
   case 45:
   case 48:
   case 49:
   case 42:
   case 82:
   case 33:
   case 7:
   case 108:
   case 109:
   case 107:
   case 112:
   case 119:
   case 121:
    return 200809;
   case 13:
   case 104:
   case 94:
   case 95:
   case 34:
   case 35:
   case 77:
   case 81:
   case 83:
   case 84:
   case 85:
   case 86:
   case 87:
   case 88:
   case 89:
   case 90:
   case 91:
   case 94:
   case 95:
   case 110:
   case 111:
   case 113:
   case 114:
   case 115:
   case 116:
   case 117:
   case 118:
   case 120:
   case 40:
   case 16:
   case 79:
   case 19:
    return -1;
   case 92:
   case 93:
   case 5:
   case 72:
   case 6:
   case 74:
   case 92:
   case 93:
   case 96:
   case 97:
   case 98:
   case 99:
   case 102:
   case 103:
   case 105:
    return 1;
   case 38:
   case 66:
   case 50:
   case 51:
   case 4:
    return 1024;
   case 15:
   case 64:
   case 41:
    return 32;
   case 55:
   case 37:
   case 17:
    return 2147483647;
   case 18:
   case 1:
    return 47839;
   case 59:
   case 57:
    return 99;
   case 68:
   case 58:
    return 2048;
   case 0:
    return 2097152;
   case 3:
    return 65536;
   case 14:
    return 32768;
   case 73:
    return 32767;
   case 39:
    return 16384;
   case 60:
    return 1e3;
   case 106:
    return 700;
   case 52:
    return 256;
   case 62:
    return 255;
   case 2:
    return 100;
   case 65:
    return 64;
   case 36:
    return 20;
   case 100:
    return 16;
   case 20:
    return 6;
   case 53:
    return 4;
  }
  ___setErrNo(ERRNO_CODES.EINVAL);
  return -1;
}

function _time(ptr) {
  var ret = Math.floor(Date.now() / 1e3);
  if (ptr) {
    HEAP32[ptr >> 2] = ret;
  }
  return ret;
}

function ___errno_location() {
  return ___setErrNo.ret;
}

var ___errno = ___errno_location;

function _sbrk(bytes) {
  var self = _sbrk;
  if (!self.called) {
    STATICTOP = alignMemoryPage(STATICTOP);
    self.called = true;
    _sbrk.DYNAMIC_START = STATICTOP;
  }
  var ret = STATICTOP;
  if (bytes != 0) Runtime.staticAlloc(bytes);
  return ret;
}

function ___gxx_personality_v0() {}

function ___cxa_allocate_exception(size) {
  return _malloc(size);
}

function _llvm_eh_exception() {
  return HEAP32[_llvm_eh_exception.buf >> 2];
}

function __ZSt18uncaught_exceptionv() {
  return !!__ZSt18uncaught_exceptionv.uncaught_exception;
}

function ___cxa_is_number_type(type) {
  var isNumber = false;
  try {
    if (type == __ZTIi) isNumber = true;
  } catch (e) {}
  try {
    if (type == __ZTIl) isNumber = true;
  } catch (e) {}
  try {
    if (type == __ZTIx) isNumber = true;
  } catch (e) {}
  try {
    if (type == __ZTIf) isNumber = true;
  } catch (e) {}
  try {
    if (type == __ZTId) isNumber = true;
  } catch (e) {}
  return isNumber;
}

function ___cxa_does_inherit(definiteType, possibilityType, possibility) {
  if (possibility == 0) return false;
  if (possibilityType == 0 || possibilityType == definiteType) return true;
  var possibility_type_info;
  if (___cxa_is_number_type(possibilityType)) {
    possibility_type_info = possibilityType;
  } else {
    var possibility_type_infoAddr = HEAP32[possibilityType >> 2] - 8;
    possibility_type_info = HEAP32[possibility_type_infoAddr >> 2];
  }
  switch (possibility_type_info) {
   case 0:
    var definite_type_infoAddr = HEAP32[definiteType >> 2] - 8;
    var definite_type_info = HEAP32[definite_type_infoAddr >> 2];
    if (definite_type_info == 0) {
      var defPointerBaseAddr = definiteType + 8;
      var defPointerBaseType = HEAP32[defPointerBaseAddr >> 2];
      var possPointerBaseAddr = possibilityType + 8;
      var possPointerBaseType = HEAP32[possPointerBaseAddr >> 2];
      return ___cxa_does_inherit(defPointerBaseType, possPointerBaseType, possibility);
    } else return false;
   case 1:
    return false;
   case 2:
    var parentTypeAddr = possibilityType + 8;
    var parentType = HEAP32[parentTypeAddr >> 2];
    return ___cxa_does_inherit(definiteType, parentType, possibility);
   default:
    return false;
  }
}

function ___cxa_find_matching_catch(thrown, throwntype, typeArray) {
  if (throwntype != 0 && !___cxa_is_number_type(throwntype)) {
    var throwntypeInfoAddr = HEAP32[throwntype >> 2] - 8;
    var throwntypeInfo = HEAP32[throwntypeInfoAddr >> 2];
    if (throwntypeInfo == 0) thrown = HEAP32[thrown >> 2];
  }
  for (var i = 0; i < typeArray.length; i++) {
    if (___cxa_does_inherit(typeArray[i], throwntype, thrown)) return {
      f0: thrown,
      f1: typeArray[i]
    };
  }
  return {
    f0: thrown,
    f1: throwntype
  };
}

function ___cxa_throw(ptr, type, destructor) {
  if (!___cxa_throw.initialized) {
    try {
      HEAP32[__ZTVN10__cxxabiv119__pointer_type_infoE >> 2] = 0;
    } catch (e) {}
    try {
      HEAP32[__ZTVN10__cxxabiv117__class_type_infoE >> 2] = 1;
    } catch (e) {}
    try {
      HEAP32[__ZTVN10__cxxabiv120__si_class_type_infoE >> 2] = 2;
    } catch (e) {}
    ___cxa_throw.initialized = true;
  }
  Module.printErr("Compiled code throwing an exception, " + [ ptr, type, destructor ] + ", at " + (new Error).stack);
  HEAP32[_llvm_eh_exception.buf >> 2] = ptr;
  HEAP32[_llvm_eh_exception.buf + 4 >> 2] = type;
  HEAP32[_llvm_eh_exception.buf + 8 >> 2] = destructor;
  if (!("uncaught_exception" in __ZSt18uncaught_exceptionv)) {
    __ZSt18uncaught_exceptionv.uncaught_exception = 1;
  } else {
    __ZSt18uncaught_exceptionv.uncaught_exception++;
  }
  throw ptr;
}

function ___cxa_call_unexpected(exception) {
  ABORT = true;
  throw exception;
}

function ___cxa_begin_catch(ptr) {
  __ZSt18uncaught_exceptionv.uncaught_exception--;
  return ptr;
}

function ___cxa_free_exception(ptr) {
  return _free(ptr);
}

function ___cxa_end_catch() {
  if (___cxa_end_catch.rethrown) {
    ___cxa_end_catch.rethrown = false;
    return;
  }
  __THREW__ = false;
  HEAP32[_llvm_eh_exception.buf + 4 >> 2] = 0;
  var ptr = HEAP32[_llvm_eh_exception.buf >> 2];
  var destructor = HEAP32[_llvm_eh_exception.buf + 8 >> 2];
  if (destructor) {
    FUNCTION_TABLE[destructor](ptr);
    HEAP32[_llvm_eh_exception.buf + 8 >> 2] = 0;
  }
  if (ptr) {
    ___cxa_free_exception(ptr);
    HEAP32[_llvm_eh_exception.buf >> 2] = 0;
  }
}

var __ZNSt9exceptionD2Ev;

var _llvm_dbg_value;

function _memchr(ptr, chr, num) {
  chr = unSign(chr);
  for (var i = 0; i < num; i++) {
    if (HEAP8[ptr] == chr) return ptr;
    ptr++;
  }
  return 0;
}

var Browser = {
  mainLoop: {
    scheduler: null,
    shouldPause: false,
    paused: false
  },
  pointerLock: false,
  moduleContextCreatedCallbacks: [],
  createContext: (function(canvas, useWebGL, setInModule) {
    try {
      var ctx = canvas.getContext(useWebGL ? "experimental-webgl" : "2d");
      if (!ctx) throw ":(";
    } catch (e) {
      Module.print("Could not create canvas - " + e);
      return null;
    }
    if (useWebGL) {
      canvas.style.backgroundColor = "black";
      canvas.addEventListener("webglcontextlost", (function(event) {
        alert("WebGL context lost. You will need to reload the page.");
      }), false);
    }
    if (setInModule) {
      Module.ctx = ctx;
      Module.useWebGL = useWebGL;
      Browser.moduleContextCreatedCallbacks.forEach((function(callback) {
        callback();
      }));
    }
    return ctx;
  }),
  requestFullScreen: (function() {
    var canvas = Module.canvas;
    function fullScreenChange() {
      if (Module["onFullScreen"]) Module["onFullScreen"]();
      if (document["webkitFullScreenElement"] === canvas || document["mozFullScreenElement"] === canvas || document["fullScreenElement"] === canvas) {
        canvas.requestPointerLock = canvas["requestPointerLock"] || canvas["mozRequestPointerLock"] || canvas["webkitRequestPointerLock"];
        canvas.requestPointerLock();
      }
    }
    document.addEventListener("fullscreenchange", fullScreenChange, false);
    document.addEventListener("mozfullscreenchange", fullScreenChange, false);
    document.addEventListener("webkitfullscreenchange", fullScreenChange, false);
    function pointerLockChange() {
      Browser.pointerLock = document["pointerLockElement"] === canvas || document["mozPointerLockElement"] === canvas || document["webkitPointerLockElement"] === canvas;
    }
    document.addEventListener("pointerlockchange", pointerLockChange, false);
    document.addEventListener("mozpointerlockchange", pointerLockChange, false);
    document.addEventListener("webkitpointerlockchange", pointerLockChange, false);
    canvas.requestFullScreen = canvas["requestFullScreen"] || canvas["mozRequestFullScreen"] || (canvas["webkitRequestFullScreen"] ? (function() {
      canvas["webkitRequestFullScreen"](Element["ALLOW_KEYBOARD_INPUT"]);
    }) : null);
    canvas.requestFullScreen();
  }),
  requestAnimationFrame: (function(func) {
    if (!window.requestAnimationFrame) {
      window.requestAnimationFrame = window["requestAnimationFrame"] || window["mozRequestAnimationFrame"] || window["webkitRequestAnimationFrame"] || window["msRequestAnimationFrame"] || window["oRequestAnimationFrame"] || window["setTimeout"];
    }
    window.requestAnimationFrame(func);
  }),
  getMovementX: (function(event) {
    return event["movementX"] || event["mozMovementX"] || event["webkitMovementX"] || 0;
  }),
  getMovementY: (function(event) {
    return event["movementY"] || event["mozMovementY"] || event["webkitMovementY"] || 0;
  }),
  xhrLoad: (function(url, onload, onerror) {
    var xhr = new XMLHttpRequest;
    xhr.open("GET", url, true);
    xhr.responseType = "arraybuffer";
    xhr.onload = (function() {
      if (xhr.status == 200) {
        onload(xhr.response);
      } else {
        onerror();
      }
    });
    xhr.onerror = onerror;
    xhr.send(null);
  }),
  asyncLoad: (function(url, callback) {
    Browser.xhrLoad(url, (function(arrayBuffer) {
      assert(arrayBuffer, 'Loading data file "' + url + '" failed (no arrayBuffer).');
      callback(new Uint8Array(arrayBuffer));
      removeRunDependency();
    }), (function(event) {
      throw 'Loading data file "' + url + '" failed.';
    }));
    addRunDependency();
  })
};

__ATINIT__.unshift({
  func: (function() {
    if (!Module["noFSInit"] && !FS.init.initialized) FS.init();
  })
});

__ATMAIN__.push({
  func: (function() {
    FS.ignorePermissions = false;
  })
});

__ATEXIT__.push({
  func: (function() {
    FS.quit();
  })
});

Module["FS_createFolder"] = FS.createFolder;

Module["FS_createPath"] = FS.createPath;

Module["FS_createDataFile"] = FS.createDataFile;

Module["FS_createLazyFile"] = FS.createLazyFile;

Module["FS_createLink"] = FS.createLink;

Module["FS_createDevice"] = FS.createDevice;

___setErrNo(0);

_llvm_eh_exception.buf = allocate(12, "void*", ALLOC_STATIC);

Module["requestFullScreen"] = (function() {
  Browser.requestFullScreen();
});

Module.callMain = function callMain(args) {
  var argc = args.length + 1;
  function pad() {
    for (var i = 0; i < 4 - 1; i++) {
      argv.push(0);
    }
  }
  var argv = [ allocate(intArrayFromString("/bin/this.program"), "i8", ALLOC_STATIC) ];
  pad();
  for (var i = 0; i < argc - 1; i = i + 1) {
    argv.push(allocate(intArrayFromString(args[i]), "i8", ALLOC_STATIC));
    pad();
  }
  argv.push(0);
  argv = allocate(argv, "i32", ALLOC_STATIC);
  return _main(argc, argv, 0);
};

var _find_block_tag_wordlist;

var _markdown_char_ptrs;

var _rndr_newbuf_buf_size;

var _sd_autolink_issafe_valid_uris;

var _sdhtml_toc_renderer_cb_default;

var _sdhtml_renderer_cb_default;

var _smartypants_cb_ptrs;

var _smartypants_cb__ltag_skip_tags;

var _HTML_ESCAPES;

var __str116;

var __gm_;

var _mparams;

var _stderr;

var __ZSt7nothrow;

var __ZL13__new_handler;

var __ZTVSt9bad_alloc;

var __ZTVSt20bad_array_new_length;

var __ZTVN10__cxxabiv120__si_class_type_infoE;

var __ZTISt9exception;

var __ZTISt9bad_alloc;

var __ZTISt20bad_array_new_length;

var __ZNSt9bad_allocC1Ev;

var __ZNSt9bad_allocD1Ev;

var __ZNSt20bad_array_new_lengthC1Ev;

var __ZNSt20bad_array_new_lengthD1Ev;

var __ZNSt20bad_array_new_lengthD2Ev;

_find_block_tag_wordlist = allocate(152, "*", ALLOC_STATIC);

STRING_TABLE.__str1 = allocate([ 112, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str2 = allocate([ 100, 108, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str3 = allocate([ 100, 105, 118, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str5 = allocate([ 116, 97, 98, 108, 101, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str6 = allocate([ 117, 108, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str7 = allocate([ 100, 101, 108, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str8 = allocate([ 102, 111, 114, 109, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str9 = allocate([ 98, 108, 111, 99, 107, 113, 117, 111, 116, 101, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str10 = allocate([ 102, 105, 103, 117, 114, 101, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str11 = allocate([ 111, 108, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str12 = allocate([ 102, 105, 101, 108, 100, 115, 101, 116, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str13 = allocate([ 104, 49, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str14 = allocate([ 104, 54, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str17 = allocate([ 104, 53, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str18 = allocate([ 110, 111, 115, 99, 114, 105, 112, 116, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str20 = allocate([ 105, 102, 114, 97, 109, 101, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str21 = allocate([ 104, 52, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str22 = allocate([ 105, 110, 115, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str23 = allocate([ 104, 51, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str24 = allocate([ 104, 50, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str25 = allocate([ 115, 114, 99, 47, 109, 97, 114, 107, 100, 111, 119, 110, 46, 99, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.___func___sd_markdown_new = allocate([ 115, 100, 95, 109, 97, 114, 107, 100, 111, 119, 110, 95, 110, 101, 119, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str26 = allocate([ 109, 97, 120, 95, 110, 101, 115, 116, 105, 110, 103, 32, 62, 32, 48, 32, 38, 38, 32, 99, 97, 108, 108, 98, 97, 99, 107, 115, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE._sd_markdown_render_UTF8_BOM = allocate([ 239, 187, 191 ], "i8", ALLOC_STATIC);

STRING_TABLE.___func___sd_markdown_render = allocate([ 115, 100, 95, 109, 97, 114, 107, 100, 111, 119, 110, 95, 114, 101, 110, 100, 101, 114, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str27 = allocate([ 109, 100, 45, 62, 119, 111, 114, 107, 95, 98, 117, 102, 115, 91, 66, 85, 70, 70, 69, 82, 95, 83, 80, 65, 78, 93, 46, 115, 105, 122, 101, 32, 61, 61, 32, 48, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str28 = allocate([ 109, 100, 45, 62, 119, 111, 114, 107, 95, 98, 117, 102, 115, 91, 66, 85, 70, 70, 69, 82, 95, 66, 76, 79, 67, 75, 93, 46, 115, 105, 122, 101, 32, 61, 61, 32, 48, 0 ], "i8", ALLOC_STATIC);

_markdown_char_ptrs = allocate([ 0, 0, 0, 0, 4, 0, 0, 0, 6, 0, 0, 0, 8, 0, 0, 0, 10, 0, 0, 0, 12, 0, 0, 0, 14, 0, 0, 0, 16, 0, 0, 0, 18, 0, 0, 0, 20, 0, 0, 0, 22, 0, 0, 0, 24, 0, 0, 0 ], [ "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0 ], ALLOC_STATIC);

STRING_TABLE.__str30 = allocate([ 92, 96, 42, 95, 123, 125, 91, 93, 40, 41, 35, 43, 45, 46, 33, 58, 124, 38, 60, 62, 94, 126, 0 ], "i8", ALLOC_STATIC);

_rndr_newbuf_buf_size = allocate([ 256, 0, 0, 0, 64, 0, 0, 0 ], [ "i32", 0, 0, 0, "i32", 0, 0, 0 ], ALLOC_STATIC);

STRING_TABLE._hash_block_tag_asso_values = allocate([ 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 8, 30, 25, 20, 15, 10, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 0, 38, 0, 38, 5, 5, 5, 15, 0, 38, 38, 0, 15, 10, 0, 38, 38, 15, 0, 5, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 0, 38, 0, 38, 5, 5, 5, 15, 0, 38, 38, 0, 15, 10, 0, 38, 38, 15, 0, 5, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38, 38 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str31 = allocate([ 115, 114, 99, 47, 98, 117, 102, 102, 101, 114, 46, 99, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.___func___bufprefix = allocate([ 98, 117, 102, 112, 114, 101, 102, 105, 120, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str132 = allocate([ 98, 117, 102, 32, 38, 38, 32, 98, 117, 102, 45, 62, 117, 110, 105, 116, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.___func___bufgrow = allocate([ 98, 117, 102, 103, 114, 111, 119, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.___func___bufcstr = allocate([ 98, 117, 102, 99, 115, 116, 114, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.___func___bufprintf = allocate([ 98, 117, 102, 112, 114, 105, 110, 116, 102, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.___func___bufput = allocate([ 98, 117, 102, 112, 117, 116, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.___func___bufputc = allocate([ 98, 117, 102, 112, 117, 116, 99, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.___func___bufslurp = allocate([ 98, 117, 102, 115, 108, 117, 114, 112, 0 ], "i8", ALLOC_STATIC);

_sd_autolink_issafe_valid_uris = allocate(20, "*", ALLOC_STATIC);

STRING_TABLE.__str45 = allocate([ 47, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str146 = allocate([ 104, 116, 116, 112, 58, 47, 47, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str247 = allocate([ 104, 116, 116, 112, 115, 58, 47, 47, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str348 = allocate([ 102, 116, 112, 58, 47, 47, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str550 = allocate([ 119, 119, 119, 46, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str651 = allocate([ 46, 43, 45, 95, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str752 = allocate([ 63, 33, 46, 44, 0 ], "i8", ALLOC_STATIC);

_sdhtml_toc_renderer_cb_default = allocate([ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 26, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 28, 0, 0, 0, 30, 0, 0, 0, 32, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 34, 0, 0, 0, 0, 0, 0, 0, 36, 0, 0, 0, 38, 0, 0, 0, 40, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 42, 0, 0, 0 ], [ "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0 ], ALLOC_STATIC);

_sdhtml_renderer_cb_default = allocate([ 44, 0, 0, 0, 46, 0, 0, 0, 48, 0, 0, 0, 50, 0, 0, 0, 52, 0, 0, 0, 54, 0, 0, 0, 56, 0, 0, 0, 58, 0, 0, 0, 60, 0, 0, 0, 62, 0, 0, 0, 64, 0, 0, 0, 66, 0, 0, 0, 28, 0, 0, 0, 30, 0, 0, 0, 32, 0, 0, 0, 68, 0, 0, 0, 70, 0, 0, 0, 72, 0, 0, 0, 74, 0, 0, 0, 36, 0, 0, 0, 38, 0, 0, 0, 40, 0, 0, 0, 0, 0, 0, 0, 76, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 ], [ "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0 ], ALLOC_STATIC);

STRING_TABLE.__str160 = allocate([ 97, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str261 = allocate([ 105, 109, 103, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str362 = allocate([ 60, 97, 32, 104, 114, 101, 102, 61, 34, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str463 = allocate([ 34, 32, 116, 105, 116, 108, 101, 61, 34, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str564 = allocate([ 34, 62, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str665 = allocate([ 60, 47, 97, 62, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str766 = allocate([ 60, 98, 114, 47, 62, 10, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str867 = allocate([ 60, 98, 114, 62, 10, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str968 = allocate([ 60, 105, 109, 103, 32, 115, 114, 99, 61, 34, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str1069 = allocate([ 34, 32, 97, 108, 116, 61, 34, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str1170 = allocate([ 34, 47, 62, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str1271 = allocate([ 109, 97, 105, 108, 116, 111, 58, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str1372 = allocate([ 60, 116, 104, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str1473 = allocate([ 60, 116, 100, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str1574 = allocate([ 32, 97, 108, 105, 103, 110, 61, 34, 99, 101, 110, 116, 101, 114, 34, 62, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str1675 = allocate([ 32, 97, 108, 105, 103, 110, 61, 34, 108, 101, 102, 116, 34, 62, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str1776 = allocate([ 32, 97, 108, 105, 103, 110, 61, 34, 114, 105, 103, 104, 116, 34, 62, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str1877 = allocate([ 62, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str1978 = allocate([ 60, 47, 116, 104, 62, 10, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str2079 = allocate([ 60, 47, 116, 100, 62, 10, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str2180 = allocate([ 60, 116, 114, 62, 10, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str2281 = allocate([ 60, 47, 116, 114, 62, 10, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str2382 = allocate([ 60, 116, 97, 98, 108, 101, 62, 60, 116, 104, 101, 97, 100, 62, 10, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str2483 = allocate([ 60, 47, 116, 104, 101, 97, 100, 62, 60, 116, 98, 111, 100, 121, 62, 10, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str2584 = allocate([ 60, 47, 116, 98, 111, 100, 121, 62, 60, 47, 116, 97, 98, 108, 101, 62, 10, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str2685 = allocate([ 60, 112, 62, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str2786 = allocate([ 60, 47, 112, 62, 10, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str2887 = allocate([ 60, 108, 105, 62, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str2988 = allocate([ 60, 47, 108, 105, 62, 10, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str3089 = allocate([ 60, 111, 108, 62, 10, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str3190 = allocate([ 60, 117, 108, 62, 10, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str32 = allocate([ 60, 47, 111, 108, 62, 10, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str33 = allocate([ 60, 47, 117, 108, 62, 10, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str34 = allocate([ 60, 104, 114, 47, 62, 10, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str35 = allocate([ 60, 104, 114, 62, 10, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str36 = allocate([ 60, 104, 37, 100, 32, 105, 100, 61, 34, 116, 111, 99, 95, 37, 100, 34, 62, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str37 = allocate([ 60, 104, 37, 100, 62, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str38 = allocate([ 60, 47, 104, 37, 100, 62, 10, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str39 = allocate([ 60, 98, 108, 111, 99, 107, 113, 117, 111, 116, 101, 62, 10, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str40 = allocate([ 60, 47, 98, 108, 111, 99, 107, 113, 117, 111, 116, 101, 62, 10, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str41 = allocate([ 60, 112, 114, 101, 62, 60, 99, 111, 100, 101, 32, 99, 108, 97, 115, 115, 61, 34, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str42 = allocate([ 60, 112, 114, 101, 62, 60, 99, 111, 100, 101, 62, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str43 = allocate([ 60, 47, 99, 111, 100, 101, 62, 60, 47, 112, 114, 101, 62, 10, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str44 = allocate([ 60, 47, 108, 105, 62, 10, 60, 47, 117, 108, 62, 10, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str4591 = allocate([ 60, 115, 117, 112, 62, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str46 = allocate([ 60, 47, 115, 117, 112, 62, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str47 = allocate([ 60, 100, 101, 108, 62, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str48 = allocate([ 60, 47, 100, 101, 108, 62, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str49 = allocate([ 60, 115, 116, 114, 111, 110, 103, 62, 60, 101, 109, 62, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str50 = allocate([ 60, 47, 101, 109, 62, 60, 47, 115, 116, 114, 111, 110, 103, 62, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str51 = allocate([ 60, 101, 109, 62, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str52 = allocate([ 60, 47, 101, 109, 62, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str53 = allocate([ 60, 115, 116, 114, 111, 110, 103, 62, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str54 = allocate([ 60, 47, 115, 116, 114, 111, 110, 103, 62, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str55 = allocate([ 60, 99, 111, 100, 101, 62, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str56 = allocate([ 60, 47, 99, 111, 100, 101, 62, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str57 = allocate([ 60, 117, 108, 62, 10, 60, 108, 105, 62, 10, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str58 = allocate([ 60, 47, 117, 108, 62, 10, 60, 47, 108, 105, 62, 10, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str5992 = allocate([ 60, 108, 105, 62, 10, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str60 = allocate([ 60, 47, 108, 105, 62, 10, 60, 108, 105, 62, 10, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str61 = allocate([ 60, 97, 32, 104, 114, 101, 102, 61, 34, 35, 116, 111, 99, 95, 37, 100, 34, 62, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str62 = allocate([ 60, 47, 97, 62, 10, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE._smartypants_cb_chars = allocate([ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 5, 3, 2, 0, 0, 0, 0, 1, 6, 0, 0, 7, 0, 7, 0, 0, 0, 0, 0, 0, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 10, 0, 0, 0, 9, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 ], "i8", ALLOC_STATIC);

_smartypants_cb_ptrs = allocate([ 0, 0, 0, 0, 78, 0, 0, 0, 80, 0, 0, 0, 82, 0, 0, 0, 84, 0, 0, 0, 86, 0, 0, 0, 88, 0, 0, 0, 90, 0, 0, 0, 92, 0, 0, 0, 94, 0, 0, 0, 96, 0, 0, 0 ], [ "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0 ], ALLOC_STATIC);

STRING_TABLE.__str95 = allocate([ 38, 37, 99, 37, 99, 113, 117, 111, 59, 0 ], "i8", ALLOC_STATIC);

_smartypants_cb__ltag_skip_tags = allocate(32, "*", ALLOC_STATIC);

STRING_TABLE.__str196 = allocate([ 112, 114, 101, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str297 = allocate([ 99, 111, 100, 101, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str398 = allocate([ 118, 97, 114, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str499 = allocate([ 115, 97, 109, 112, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str5100 = allocate([ 107, 98, 100, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str6101 = allocate([ 109, 97, 116, 104, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str7102 = allocate([ 115, 99, 114, 105, 112, 116, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str8103 = allocate([ 115, 116, 121, 108, 101, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str9104 = allocate([ 38, 102, 114, 97, 99, 49, 50, 59, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str10105 = allocate([ 38, 102, 114, 97, 99, 49, 52, 59, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str11106 = allocate([ 38, 102, 114, 97, 99, 51, 52, 59, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str12107 = allocate([ 38, 104, 101, 108, 108, 105, 112, 59, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str14109 = allocate([ 38, 35, 48, 59, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str15110 = allocate([ 38, 114, 115, 113, 117, 111, 59, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str16111 = allocate([ 38, 99, 111, 112, 121, 59, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str17112 = allocate([ 38, 114, 101, 103, 59, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str18113 = allocate([ 38, 116, 114, 97, 100, 101, 59, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str19114 = allocate([ 38, 109, 100, 97, 115, 104, 59, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str20115 = allocate([ 38, 110, 100, 97, 115, 104, 59, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE._HTML_ESCAPE_TABLE = allocate([ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 2, 3, 0, 0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 ], "i8", ALLOC_STATIC);

_HTML_ESCAPES = allocate(28, "*", ALLOC_STATIC);

__str116 = allocate(1, "i8", ALLOC_STATIC);

STRING_TABLE.__str1117 = allocate([ 38, 113, 117, 111, 116, 59, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str3119 = allocate([ 38, 35, 51, 57, 59, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str4120 = allocate([ 38, 35, 52, 55, 59, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str5121 = allocate([ 38, 108, 116, 59, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str6122 = allocate([ 38, 103, 116, 59, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE._houdini_escape_href_hex_chars = allocate([ 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 65, 66, 67, 68, 69, 70, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE._HREF_SAFE = allocate([ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str125 = allocate([ 38, 97, 109, 112, 59, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str1126 = allocate([ 38, 35, 120, 50, 55, 59, 0 ], "i8", ALLOC_STATIC);

__gm_ = allocate(468, [ "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "i32", 0, 0, 0, "*", 0, 0, 0, "i32", 0, 0, 0, "*", 0, 0, 0, "i32", 0, 0, 0, "*", 0, 0, 0, "i32", 0, 0, 0 ], ALLOC_STATIC);

_mparams = allocate(24, "i32", ALLOC_STATIC);

STRING_TABLE.__str63 = allocate([ 109, 97, 120, 32, 115, 121, 115, 116, 101, 109, 32, 98, 121, 116, 101, 115, 32, 61, 32, 37, 49, 48, 108, 117, 10, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str164 = allocate([ 115, 121, 115, 116, 101, 109, 32, 98, 121, 116, 101, 115, 32, 32, 32, 32, 32, 61, 32, 37, 49, 48, 108, 117, 10, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__str265 = allocate([ 105, 110, 32, 117, 115, 101, 32, 98, 121, 116, 101, 115, 32, 32, 32, 32, 32, 61, 32, 37, 49, 48, 108, 117, 10, 0 ], "i8", ALLOC_STATIC);

__ZSt7nothrow = allocate(1, "i8", ALLOC_STATIC);

__ZL13__new_handler = allocate(1, "void ()*", ALLOC_STATIC);

__ZTVSt9bad_alloc = allocate([ 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 98, 0, 0, 0, 100, 0, 0, 0 ], [ "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0 ], ALLOC_STATIC);

allocate(1, "void*", ALLOC_STATIC);

STRING_TABLE.__str366 = allocate([ 115, 116, 100, 58, 58, 98, 97, 100, 95, 97, 108, 108, 111, 99, 0 ], "i8", ALLOC_STATIC);

__ZTVSt20bad_array_new_length = allocate([ 0, 0, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0, 102, 0, 0, 0, 104, 0, 0, 0 ], [ "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0, "*", 0, 0, 0 ], ALLOC_STATIC);

allocate(1, "void*", ALLOC_STATIC);

STRING_TABLE.__str1467 = allocate([ 98, 97, 100, 95, 97, 114, 114, 97, 121, 95, 110, 101, 119, 95, 108, 101, 110, 103, 116, 104, 0 ], "i8", ALLOC_STATIC);

STRING_TABLE.__ZTSSt9bad_alloc = allocate([ 83, 116, 57, 98, 97, 100, 95, 97, 108, 108, 111, 99, 0 ], "i8", ALLOC_STATIC);

__ZTISt9bad_alloc = allocate(12, "*", ALLOC_STATIC);

STRING_TABLE.__ZTSSt20bad_array_new_length = allocate([ 83, 116, 50, 48, 98, 97, 100, 95, 97, 114, 114, 97, 121, 95, 110, 101, 119, 95, 108, 101, 110, 103, 116, 104, 0 ], "i8", ALLOC_STATIC);

__ZTISt20bad_array_new_length = allocate(12, "*", ALLOC_STATIC);

HEAP32[_find_block_tag_wordlist >> 2] = __str116 | 0;

HEAP32[_find_block_tag_wordlist + 4 >> 2] = STRING_TABLE.__str1 | 0;

HEAP32[_find_block_tag_wordlist + 8 >> 2] = STRING_TABLE.__str2 | 0;

HEAP32[_find_block_tag_wordlist + 12 >> 2] = STRING_TABLE.__str3 | 0;

HEAP32[_find_block_tag_wordlist + 16 >> 2] = STRING_TABLE.__str6101 | 0;

HEAP32[_find_block_tag_wordlist + 20 >> 2] = STRING_TABLE.__str5 | 0;

HEAP32[_find_block_tag_wordlist + 24 >> 2] = __str116 | 0;

HEAP32[_find_block_tag_wordlist + 28 >> 2] = STRING_TABLE.__str6 | 0;

HEAP32[_find_block_tag_wordlist + 32 >> 2] = STRING_TABLE.__str7 | 0;

HEAP32[_find_block_tag_wordlist + 36 >> 2] = STRING_TABLE.__str8 | 0;

HEAP32[_find_block_tag_wordlist + 40 >> 2] = STRING_TABLE.__str9 | 0;

HEAP32[_find_block_tag_wordlist + 44 >> 2] = STRING_TABLE.__str10 | 0;

HEAP32[_find_block_tag_wordlist + 48 >> 2] = STRING_TABLE.__str11 | 0;

HEAP32[_find_block_tag_wordlist + 52 >> 2] = STRING_TABLE.__str12 | 0;

HEAP32[_find_block_tag_wordlist + 56 >> 2] = __str116 | 0;

HEAP32[_find_block_tag_wordlist + 60 >> 2] = STRING_TABLE.__str13 | 0;

HEAP32[_find_block_tag_wordlist + 64 >> 2] = __str116 | 0;

HEAP32[_find_block_tag_wordlist + 68 >> 2] = STRING_TABLE.__str14 | 0;

HEAP32[_find_block_tag_wordlist + 72 >> 2] = STRING_TABLE.__str196 | 0;

HEAP32[_find_block_tag_wordlist + 76 >> 2] = __str116 | 0;

HEAP32[_find_block_tag_wordlist + 80 >> 2] = __str116 | 0;

HEAP32[_find_block_tag_wordlist + 84 >> 2] = STRING_TABLE.__str7102 | 0;

HEAP32[_find_block_tag_wordlist + 88 >> 2] = STRING_TABLE.__str17 | 0;

HEAP32[_find_block_tag_wordlist + 92 >> 2] = STRING_TABLE.__str18 | 0;

HEAP32[_find_block_tag_wordlist + 96 >> 2] = __str116 | 0;

HEAP32[_find_block_tag_wordlist + 100 >> 2] = STRING_TABLE.__str8103 | 0;

HEAP32[_find_block_tag_wordlist + 104 >> 2] = STRING_TABLE.__str20 | 0;

HEAP32[_find_block_tag_wordlist + 108 >> 2] = STRING_TABLE.__str21 | 0;

HEAP32[_find_block_tag_wordlist + 112 >> 2] = STRING_TABLE.__str22 | 0;

HEAP32[_find_block_tag_wordlist + 116 >> 2] = __str116 | 0;

HEAP32[_find_block_tag_wordlist + 120 >> 2] = __str116 | 0;

HEAP32[_find_block_tag_wordlist + 124 >> 2] = __str116 | 0;

HEAP32[_find_block_tag_wordlist + 128 >> 2] = STRING_TABLE.__str23 | 0;

HEAP32[_find_block_tag_wordlist + 132 >> 2] = __str116 | 0;

HEAP32[_find_block_tag_wordlist + 136 >> 2] = __str116 | 0;

HEAP32[_find_block_tag_wordlist + 140 >> 2] = __str116 | 0;

HEAP32[_find_block_tag_wordlist + 144 >> 2] = __str116 | 0;

HEAP32[_find_block_tag_wordlist + 148 >> 2] = STRING_TABLE.__str24 | 0;

HEAP32[_sd_autolink_issafe_valid_uris >> 2] = STRING_TABLE.__str45 | 0;

HEAP32[_sd_autolink_issafe_valid_uris + 4 >> 2] = STRING_TABLE.__str146 | 0;

HEAP32[_sd_autolink_issafe_valid_uris + 8 >> 2] = STRING_TABLE.__str247 | 0;

HEAP32[_sd_autolink_issafe_valid_uris + 12 >> 2] = STRING_TABLE.__str348 | 0;

HEAP32[_sd_autolink_issafe_valid_uris + 16 >> 2] = STRING_TABLE.__str1271 | 0;

HEAP32[_smartypants_cb__ltag_skip_tags >> 2] = STRING_TABLE.__str196 | 0;

HEAP32[_smartypants_cb__ltag_skip_tags + 4 >> 2] = STRING_TABLE.__str297 | 0;

HEAP32[_smartypants_cb__ltag_skip_tags + 8 >> 2] = STRING_TABLE.__str398 | 0;

HEAP32[_smartypants_cb__ltag_skip_tags + 12 >> 2] = STRING_TABLE.__str499 | 0;

HEAP32[_smartypants_cb__ltag_skip_tags + 16 >> 2] = STRING_TABLE.__str5100 | 0;

HEAP32[_smartypants_cb__ltag_skip_tags + 20 >> 2] = STRING_TABLE.__str6101 | 0;

HEAP32[_smartypants_cb__ltag_skip_tags + 24 >> 2] = STRING_TABLE.__str7102 | 0;

HEAP32[_smartypants_cb__ltag_skip_tags + 28 >> 2] = STRING_TABLE.__str8103 | 0;

HEAP32[_HTML_ESCAPES >> 2] = __str116 | 0;

HEAP32[_HTML_ESCAPES + 4 >> 2] = STRING_TABLE.__str1117 | 0;

HEAP32[_HTML_ESCAPES + 8 >> 2] = STRING_TABLE.__str125 | 0;

HEAP32[_HTML_ESCAPES + 12 >> 2] = STRING_TABLE.__str3119 | 0;

HEAP32[_HTML_ESCAPES + 16 >> 2] = STRING_TABLE.__str4120 | 0;

HEAP32[_HTML_ESCAPES + 20 >> 2] = STRING_TABLE.__str5121 | 0;

HEAP32[_HTML_ESCAPES + 24 >> 2] = STRING_TABLE.__str6122 | 0;

HEAP32[__ZTVSt9bad_alloc + 4 >> 2] = __ZTISt9bad_alloc;

HEAP32[__ZTVSt20bad_array_new_length + 4 >> 2] = __ZTISt20bad_array_new_length;

__ZTVN10__cxxabiv120__si_class_type_infoE = allocate([ 2, 0, 0, 0, 0 ], [ "i8*", 0, 0, 0, 0 ], ALLOC_STATIC);

HEAP32[__ZTISt9bad_alloc >> 2] = __ZTVN10__cxxabiv120__si_class_type_infoE + 8 | 0;

HEAP32[__ZTISt9bad_alloc + 4 >> 2] = STRING_TABLE.__ZTSSt9bad_alloc | 0;

HEAP32[__ZTISt9bad_alloc + 8 >> 2] = __ZTISt9exception;

HEAP32[__ZTISt20bad_array_new_length >> 2] = __ZTVN10__cxxabiv120__si_class_type_infoE + 8 | 0;

HEAP32[__ZTISt20bad_array_new_length + 4 >> 2] = STRING_TABLE.__ZTSSt20bad_array_new_length | 0;

HEAP32[__ZTISt20bad_array_new_length + 8 >> 2] = __ZTISt9bad_alloc;

__ZNSt9bad_allocC1Ev = 106;

__ZNSt9bad_allocD1Ev = 2;

__ZNSt20bad_array_new_lengthC1Ev = 108;

__ZNSt20bad_array_new_lengthD1Ev = 2;

__ZNSt20bad_array_new_lengthD2Ev = 2;

FUNCTION_TABLE = [ 0, 0, __ZNSt9bad_allocD2Ev, 0, _char_emphasis, 0, _char_codespan, 0, _char_linebreak, 0, _char_link, 0, _char_langle_tag, 0, _char_escape, 0, _char_entity, 0, _char_autolink_url, 0, _char_autolink_email, 0, _char_autolink_www, 0, _char_superscript, 0, _toc_header, 0, _rndr_codespan, 0, _rndr_double_emphasis, 0, _rndr_emphasis, 0, _toc_link, 0, _rndr_triple_emphasis, 0, _rndr_strikethrough, 0, _rndr_superscript, 0, _toc_finalize, 0, _rndr_blockcode, 0, _rndr_blockquote, 0, _rndr_raw_block, 0, _rndr_header, 0, _rndr_hrule, 0, _rndr_list, 0, _rndr_listitem, 0, _rndr_paragraph, 0, _rndr_table, 0, _rndr_tablerow, 0, _rndr_tablecell, 0, _rndr_autolink, 0, _rndr_image, 0, _rndr_linebreak, 0, _rndr_link, 0, _rndr_raw_html, 0, _rndr_normal_text, 0, _smartypants_cb__dash, 0, _smartypants_cb__parens, 0, _smartypants_cb__squote, 0, _smartypants_cb__dquote, 0, _smartypants_cb__amp, 0, _smartypants_cb__period, 0, _smartypants_cb__number, 0, _smartypants_cb__ltag, 0, _smartypants_cb__backtick, 0, _smartypants_cb__escape, 0, __ZNSt9bad_allocD0Ev, 0, __ZNKSt9bad_alloc4whatEv, 0, __ZNSt20bad_array_new_lengthD0Ev, 0, __ZNKSt20bad_array_new_length4whatEv, 0, __ZNSt9bad_allocC2Ev, 0, __ZNSt20bad_array_new_lengthC2Ev, 0 ];

Module["FUNCTION_TABLE"] = FUNCTION_TABLE;

function run(args) {
  args = args || Module["arguments"];
  if (Module["preRun"]) {
    if (typeof Module["preRun"] == "function") Module["preRun"] = [ Module["preRun"] ];
    while (Module["preRun"].length > 0) {
      Module["preRun"].pop()();
      if (runDependencies > 0) {
        return 0;
      }
    }
  }
  function doRun() {
    var ret = 0;
    if (Module["_main"]) {
      preMain();
      ret = Module.callMain(args);
      if (!Module["noExitRuntime"]) {
        exitRuntime();
      }
    }
    if (Module["postRun"]) {
      if (typeof Module["postRun"] == "function") Module["postRun"] = [ Module["postRun"] ];
      while (Module["postRun"].length > 0) {
        Module["postRun"].pop()();
      }
    }
    return ret;
  }
  if (Module["setStatus"]) {
    Module["setStatus"]("Running...");
    setTimeout((function() {
      setTimeout((function() {
        Module["setStatus"]("");
      }), 1);
      doRun();
    }), 1);
    return 0;
  } else {
    return doRun();
  }
}

Module["run"] = run;

initRuntime();

if (Module["noInitialRun"]) {
  addRunDependency();
}

if (runDependencies == 0) {
  var ret = run();
}
// EMSCRIPTEN_GENERATED_FUNCTIONS: ["_hash_block_tag","_str_to_html","_find_block_tag","_sd_markdown_new","_sd_markdown_render","_is_ref","_expand_tabs","_sd_version","_is_atxheader","_is_empty","_is_hrule","_parse_block","_free_link_refs","_sd_markdown_free","_parse_atxheader","_parse_htmlblock","_parse_fencedcode","_parse_table","_prefix_quote","_prefix_code","_is_headerline","_parse_blockquote","_parse_blockcode","_prefix_uli","_parse_list","_prefix_oli","_parse_paragraph","_is_codefence","_rndr_newbuf","_rndr_popbuf","_parse_inline","_char_emphasis","_char_codespan","_char_linebreak","_char_link","_char_langle_tag","_char_escape","__isspace","_char_entity","_char_autolink_url","_char_autolink_email","_char_autolink_www","_char_superscript","_tag_length","_unscape_text","_is_mail_autolink","_find_link_ref","_hash_link_ref","_parse_emph1","_parse_emph2","_parse_emph3","_find_emph_char","_prefix_codefence","_is_next_headerline","_parse_listitem","_parse_table_header","_parse_table_row","_stack_pop","_stack_top","_htmlblock_end","_htmlblock_end_tag","_add_link_ref","_stack_grow","_stack_free","_stack_init","_stack_push","_bufprefix","_bufgrow","_bufnew","_bufcstr","_bufprintf","_bufput","_bufputs","_bufputc","_bufrelease","_bufreset","_bufslurp","_sd_autolink_issafe","_sd_autolink__www","_check_domain","_autolink_delim","_sd_autolink__email","_sd_autolink__url","_sdhtml_is_tag","_sdhtml_toc_renderer","_toc_header","_rndr_codespan","_rndr_double_emphasis","_rndr_emphasis","_toc_link","_rndr_triple_emphasis","_rndr_strikethrough","_rndr_superscript","_toc_finalize","_sdhtml_renderer","_rndr_blockcode","_rndr_blockquote","_rndr_raw_block","_rndr_header","_rndr_hrule","_rndr_list","_rndr_listitem","_rndr_paragraph","_rndr_table","_rndr_tablerow","_rndr_tablecell","_rndr_autolink","_rndr_image","_rndr_linebreak","_rndr_link","_rndr_raw_html","_rndr_normal_text","_escape_html","_escape_href","_sdhtml_smartypants","_smartypants_cb__dash","_smartypants_cb__parens","_smartypants_cb__squote","_smartypants_cb__dquote","_smartypants_cb__amp","_smartypants_cb__period","_smartypants_cb__number","_smartypants_cb__ltag","_smartypants_cb__backtick","_smartypants_cb__escape","_smartypants_quotes","_word_boundary","_houdini_escape_html0","_houdini_escape_html","_houdini_escape_href","_malloc","_tmalloc_small","_tmalloc_large","_sys_alloc","_release_unused_segments","_sys_trim","_free","_malloc_footprint","_malloc_max_footprint","_malloc_usable_size","_mmap_resize","_calloc","_realloc","_memalign","_internal_memalign","_independent_calloc","_ialloc","_independent_comalloc","_valloc","_pvalloc","_malloc_trim","_mallinfo","_internal_mallinfo","_malloc_stats","_internal_malloc_stats","_mallopt","_change_mparam","_internal_realloc","_init_mparams","_segment_holding","_init_top","_init_bins","_prepend_alloc","_add_segment","__ZNKSt9bad_alloc4whatEv","__ZNKSt20bad_array_new_length4whatEv","__ZSt15get_new_handlerv","__ZSt15set_new_handlerPFvvE","__ZNSt9bad_allocC2Ev","__ZdlPv","__ZdlPvRKSt9nothrow_t","__ZdaPv","__ZdaPvRKSt9nothrow_t","__ZNSt9bad_allocD0Ev","__ZNSt9bad_allocD2Ev","__ZNSt20bad_array_new_lengthC2Ev","__ZNSt20bad_array_new_lengthD0Ev","__Znwj","__ZnwjRKSt9nothrow_t","__Znaj","__ZnajRKSt9nothrow_t","__ZSt17__throw_bad_allocv"]

