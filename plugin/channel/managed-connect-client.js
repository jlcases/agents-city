import { createRequire as __bundleCreateRequire } from 'node:module';
import { fileURLToPath as __bundleFileURLToPath } from 'node:url';
import { dirname as __bundleDirname } from 'node:path';
const require = __bundleCreateRequire(import.meta.url);
const __filename = __bundleFileURLToPath(import.meta.url);
const __dirname = __bundleDirname(__filename);
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(x) {
  if (typeof require !== "undefined") return require.apply(this, arguments);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
var __commonJS = (cb, mod) => function __require2() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// node_modules/@kinsh/vodozemac-wasm/pkg-node/kinsh_vodozemac_wasm.js
var require_kinsh_vodozemac_wasm = __commonJS({
  "node_modules/@kinsh/vodozemac-wasm/pkg-node/kinsh_vodozemac_wasm.js"(exports, module) {
    var Account2 = class _Account {
      static __wrap(ptr) {
        const obj = Object.create(_Account.prototype);
        obj.__wbg_ptr = ptr;
        AccountFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
      }
      __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        AccountFinalization.unregister(this);
        return ptr;
      }
      free() {
        const ptr = this.__destroy_into_raw();
        wasm2.__wbg_account_free(ptr, 0);
      }
      /**
       * Create an inbound session from a received prekey message body.
       * The peer's identity key is extracted from the message itself
       * (libolm-compatible behaviour). Returns both the new session and
       * the decrypted plaintext of the initial message in one shot.
       * @param {string} prekey_message_body
       * @returns {InboundResult}
       */
      createInboundSession(prekey_message_body) {
        const ptr0 = passStringToWasm0(prekey_message_body, wasm2.__wbindgen_malloc, wasm2.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN2;
        const ret = wasm2.account_createInboundSession(this.__wbg_ptr, ptr0, len0);
        if (ret[2]) {
          throw takeFromExternrefTable0(ret[1]);
        }
        return InboundResult.__wrap(ret[0]);
      }
      /**
       * Create an outbound Olm session targeting a peer device, using their
       * identity key + one-time-key (or fallback prekey when pool is empty).
       * Both keys are base64.
       * @param {string} their_identity_key
       * @param {string} their_one_time_key
       * @returns {Session}
       */
      createOutboundSession(their_identity_key, their_one_time_key) {
        const ptr0 = passStringToWasm0(their_identity_key, wasm2.__wbindgen_malloc, wasm2.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN2;
        const ptr1 = passStringToWasm0(their_one_time_key, wasm2.__wbindgen_malloc, wasm2.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN2;
        const ret = wasm2.account_createOutboundSession(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        if (ret[2]) {
          throw takeFromExternrefTable0(ret[1]);
        }
        return Session2.__wrap(ret[0]);
      }
      /**
       * Returns the unpublished fallback key as a JSON string in the same
       * shape as `oneTimeKeys()` — `{ "curve25519": { "<id>": "<pub>" } }`.
       * Empty inner map if no unpublished fallback exists.
       * @returns {string}
       */
      fallbackKey() {
        let deferred2_0;
        let deferred2_1;
        try {
          const ret = wasm2.account_fallbackKey(this.__wbg_ptr);
          var ptr1 = ret[0];
          var len1 = ret[1];
          if (ret[3]) {
            ptr1 = 0;
            len1 = 0;
            throw takeFromExternrefTable0(ret[2]);
          }
          deferred2_0 = ptr1;
          deferred2_1 = len1;
          return getStringFromWasm02(ptr1, len1);
        } finally {
          wasm2.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
      }
      /**
       * Restore from a JSON pickle produced by `pickle()`.
       * @param {string} pickle
       * @returns {Account}
       */
      static fromPickle(pickle) {
        const ptr0 = passStringToWasm0(pickle, wasm2.__wbindgen_malloc, wasm2.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN2;
        const ret = wasm2.account_fromPickle(ptr0, len0);
        if (ret[2]) {
          throw takeFromExternrefTable0(ret[1]);
        }
        return _Account.__wrap(ret[0]);
      }
      generateFallbackKey() {
        wasm2.account_generateFallbackKey(this.__wbg_ptr);
      }
      /**
       * @param {number} count
       */
      generateOneTimeKeys(count) {
        wasm2.account_generateOneTimeKeys(this.__wbg_ptr, count);
      }
      /**
       * JSON string `{ "curve25519": "<base64>", "ed25519": "<base64>" }`.
       * Returning JSON (rather than a JS Map) keeps the API drop-in for
       * libolm-shaped consumers — caller does `JSON.parse(account.identityKeys())`.
       * @returns {string}
       */
      identityKeys() {
        let deferred2_0;
        let deferred2_1;
        try {
          const ret = wasm2.account_identityKeys(this.__wbg_ptr);
          var ptr1 = ret[0];
          var len1 = ret[1];
          if (ret[3]) {
            ptr1 = 0;
            len1 = 0;
            throw takeFromExternrefTable0(ret[2]);
          }
          deferred2_0 = ptr1;
          deferred2_1 = len1;
          return getStringFromWasm02(ptr1, len1);
        } finally {
          wasm2.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
      }
      markKeysAsPublished() {
        wasm2.account_markKeysAsPublished(this.__wbg_ptr);
      }
      /**
       * @returns {number}
       */
      maxNumberOfOneTimeKeys() {
        const ret = wasm2.account_maxNumberOfOneTimeKeys(this.__wbg_ptr);
        return ret >>> 0;
      }
      constructor() {
        const ret = wasm2.account_new();
        this.__wbg_ptr = ret;
        AccountFinalization.register(this, this.__wbg_ptr, this);
        return this;
      }
      /**
       * Returns unpublished one-time keys as a JSON string:
       * `{ "curve25519": { "<keyId>": "<publicKey>" } }`.
       * After `markKeysAsPublished`, the inner map is empty.
       * @returns {string}
       */
      oneTimeKeys() {
        let deferred2_0;
        let deferred2_1;
        try {
          const ret = wasm2.account_oneTimeKeys(this.__wbg_ptr);
          var ptr1 = ret[0];
          var len1 = ret[1];
          if (ret[3]) {
            ptr1 = 0;
            len1 = 0;
            throw takeFromExternrefTable0(ret[2]);
          }
          deferred2_0 = ptr1;
          deferred2_1 = len1;
          return getStringFromWasm02(ptr1, len1);
        } finally {
          wasm2.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
      }
      /**
       * Returns the JSON pickle string. Persist however appropriate for
       * the runtime.
       * @returns {string}
       */
      pickle() {
        let deferred2_0;
        let deferred2_1;
        try {
          const ret = wasm2.account_pickle(this.__wbg_ptr);
          var ptr1 = ret[0];
          var len1 = ret[1];
          if (ret[3]) {
            ptr1 = 0;
            len1 = 0;
            throw takeFromExternrefTable0(ret[2]);
          }
          deferred2_0 = ptr1;
          deferred2_1 = len1;
          return getStringFromWasm02(ptr1, len1);
        } finally {
          wasm2.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
      }
      /**
       * Sign the given message with this account's Ed25519 identity key,
       * returning a base64-encoded signature.
       * @param {string} message
       * @returns {string}
       */
      sign(message) {
        let deferred2_0;
        let deferred2_1;
        try {
          const ptr0 = passStringToWasm0(message, wasm2.__wbindgen_malloc, wasm2.__wbindgen_realloc);
          const len0 = WASM_VECTOR_LEN2;
          const ret = wasm2.account_sign(this.__wbg_ptr, ptr0, len0);
          deferred2_0 = ret[0];
          deferred2_1 = ret[1];
          return getStringFromWasm02(ret[0], ret[1]);
        } finally {
          wasm2.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
      }
    };
    if (Symbol.dispose) Account2.prototype[Symbol.dispose] = Account2.prototype.free;
    exports.Account = Account2;
    var GroupSession = class _GroupSession {
      static __wrap(ptr) {
        const obj = Object.create(_GroupSession.prototype);
        obj.__wbg_ptr = ptr;
        GroupSessionFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
      }
      __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        GroupSessionFinalization.unregister(this);
        return ptr;
      }
      free() {
        const ptr = this.__destroy_into_raw();
        wasm2.__wbg_groupsession_free(ptr, 0);
      }
      /**
       * Encrypt, returning the base64 megolm message body. No type field —
       * megolm has a single message kind (contrast with Olm's prekey/normal).
       * @param {string} plaintext
       * @returns {string}
       */
      encrypt(plaintext) {
        let deferred2_0;
        let deferred2_1;
        try {
          const ptr0 = passStringToWasm0(plaintext, wasm2.__wbindgen_malloc, wasm2.__wbindgen_realloc);
          const len0 = WASM_VECTOR_LEN2;
          const ret = wasm2.groupsession_encrypt(this.__wbg_ptr, ptr0, len0);
          deferred2_0 = ret[0];
          deferred2_1 = ret[1];
          return getStringFromWasm02(ret[0], ret[1]);
        } finally {
          wasm2.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
      }
      /**
       * Restore from a JSON pickle produced by `pickle()`.
       * @param {string} pickle
       * @returns {GroupSession}
       */
      static fromPickle(pickle) {
        const ptr0 = passStringToWasm0(pickle, wasm2.__wbindgen_malloc, wasm2.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN2;
        const ret = wasm2.groupsession_fromPickle(ptr0, len0);
        if (ret[2]) {
          throw takeFromExternrefTable0(ret[1]);
        }
        return _GroupSession.__wrap(ret[0]);
      }
      /**
       * Ratchet index of the **next** message to be encrypted.
       * @returns {number}
       */
      messageIndex() {
        const ret = wasm2.groupsession_messageIndex(this.__wbg_ptr);
        return ret >>> 0;
      }
      constructor() {
        const ret = wasm2.groupsession_new();
        this.__wbg_ptr = ret;
        GroupSessionFinalization.register(this, this.__wbg_ptr, this);
        return this;
      }
      /**
       * Returns the JSON pickle string.
       * @returns {string}
       */
      pickle() {
        let deferred2_0;
        let deferred2_1;
        try {
          const ret = wasm2.groupsession_pickle(this.__wbg_ptr);
          var ptr1 = ret[0];
          var len1 = ret[1];
          if (ret[3]) {
            ptr1 = 0;
            len1 = 0;
            throw takeFromExternrefTable0(ret[2]);
          }
          deferred2_0 = ptr1;
          deferred2_1 = len1;
          return getStringFromWasm02(ptr1, len1);
        } finally {
          wasm2.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
      }
      /**
       * @returns {string}
       */
      sessionId() {
        let deferred1_0;
        let deferred1_1;
        try {
          const ret = wasm2.groupsession_sessionId(this.__wbg_ptr);
          deferred1_0 = ret[0];
          deferred1_1 = ret[1];
          return getStringFromWasm02(ret[0], ret[1]);
        } finally {
          wasm2.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
      }
      /**
       * Base64 session key at the **current** ratchet index. Share this with
       * group members (over Olm); they construct an `InboundGroupSession`
       * from it and can decrypt everything from this index onward.
       * @returns {string}
       */
      sessionKey() {
        let deferred1_0;
        let deferred1_1;
        try {
          const ret = wasm2.groupsession_sessionKey(this.__wbg_ptr);
          deferred1_0 = ret[0];
          deferred1_1 = ret[1];
          return getStringFromWasm02(ret[0], ret[1]);
        } finally {
          wasm2.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
      }
    };
    if (Symbol.dispose) GroupSession.prototype[Symbol.dispose] = GroupSession.prototype.free;
    exports.GroupSession = GroupSession;
    var InboundGroupSession = class _InboundGroupSession {
      static __wrap(ptr) {
        const obj = Object.create(_InboundGroupSession.prototype);
        obj.__wbg_ptr = ptr;
        InboundGroupSessionFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
      }
      __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        InboundGroupSessionFinalization.unregister(this);
        return ptr;
      }
      free() {
        const ptr = this.__destroy_into_raw();
        wasm2.__wbg_inboundgroupsession_free(ptr, 0);
      }
      /**
       * Decrypt a base64 megolm message body. Returns a JSON string
       * `{ "plaintext": "...", "messageIndex": n }`.
       * @param {string} message
       * @returns {string}
       */
      decrypt(message) {
        let deferred3_0;
        let deferred3_1;
        try {
          const ptr0 = passStringToWasm0(message, wasm2.__wbindgen_malloc, wasm2.__wbindgen_realloc);
          const len0 = WASM_VECTOR_LEN2;
          const ret = wasm2.inboundgroupsession_decrypt(this.__wbg_ptr, ptr0, len0);
          var ptr2 = ret[0];
          var len2 = ret[1];
          if (ret[3]) {
            ptr2 = 0;
            len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
          }
          deferred3_0 = ptr2;
          deferred3_1 = len2;
          return getStringFromWasm02(ptr2, len2);
        } finally {
          wasm2.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
      }
      /**
       * Export the session key at the given ratchet index (base64), e.g. for
       * sharing history with a newly joined member. Returns `undefined` when
       * the index is below `firstKnownIndex()`.
       * @param {number} index
       * @returns {string | undefined}
       */
      exportAt(index) {
        const ret = wasm2.inboundgroupsession_exportAt(this.__wbg_ptr, index);
        let v1;
        if (ret[0] !== 0) {
          v1 = getStringFromWasm02(ret[0], ret[1]).slice();
          wasm2.__wbindgen_free(ret[0], ret[1] * 1, 1);
        }
        return v1;
      }
      /**
       * Lowest ratchet index this session can decrypt.
       * @returns {number}
       */
      firstKnownIndex() {
        const ret = wasm2.inboundgroupsession_firstKnownIndex(this.__wbg_ptr);
        return ret >>> 0;
      }
      /**
       * Restore from a JSON pickle produced by `pickle()`.
       * @param {string} pickle
       * @returns {InboundGroupSession}
       */
      static fromPickle(pickle) {
        const ptr0 = passStringToWasm0(pickle, wasm2.__wbindgen_malloc, wasm2.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN2;
        const ret = wasm2.inboundgroupsession_fromPickle(ptr0, len0);
        if (ret[2]) {
          throw takeFromExternrefTable0(ret[1]);
        }
        return _InboundGroupSession.__wrap(ret[0]);
      }
      /**
       * Construct from a base64 **exported** key produced by `exportAt()`.
       * Exported keys lose the signing chain, so sessions imported this way
       * can decrypt but cannot prove who created the session.
       * @param {string} exported_session_key
       * @returns {InboundGroupSession}
       */
      static import(exported_session_key) {
        const ptr0 = passStringToWasm0(exported_session_key, wasm2.__wbindgen_malloc, wasm2.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN2;
        const ret = wasm2.inboundgroupsession_import(ptr0, len0);
        if (ret[2]) {
          throw takeFromExternrefTable0(ret[1]);
        }
        return _InboundGroupSession.__wrap(ret[0]);
      }
      /**
       * Construct from a base64 session key produced by
       * `GroupSession.sessionKey()`.
       * @param {string} session_key
       */
      constructor(session_key) {
        const ptr0 = passStringToWasm0(session_key, wasm2.__wbindgen_malloc, wasm2.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN2;
        const ret = wasm2.inboundgroupsession_new(ptr0, len0);
        if (ret[2]) {
          throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        InboundGroupSessionFinalization.register(this, this.__wbg_ptr, this);
        return this;
      }
      /**
       * Returns the JSON pickle string.
       * @returns {string}
       */
      pickle() {
        let deferred2_0;
        let deferred2_1;
        try {
          const ret = wasm2.inboundgroupsession_pickle(this.__wbg_ptr);
          var ptr1 = ret[0];
          var len1 = ret[1];
          if (ret[3]) {
            ptr1 = 0;
            len1 = 0;
            throw takeFromExternrefTable0(ret[2]);
          }
          deferred2_0 = ptr1;
          deferred2_1 = len1;
          return getStringFromWasm02(ptr1, len1);
        } finally {
          wasm2.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
      }
      /**
       * @returns {string}
       */
      sessionId() {
        let deferred1_0;
        let deferred1_1;
        try {
          const ret = wasm2.inboundgroupsession_sessionId(this.__wbg_ptr);
          deferred1_0 = ret[0];
          deferred1_1 = ret[1];
          return getStringFromWasm02(ret[0], ret[1]);
        } finally {
          wasm2.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
      }
    };
    if (Symbol.dispose) InboundGroupSession.prototype[Symbol.dispose] = InboundGroupSession.prototype.free;
    exports.InboundGroupSession = InboundGroupSession;
    var InboundResult = class _InboundResult {
      static __wrap(ptr) {
        const obj = Object.create(_InboundResult.prototype);
        obj.__wbg_ptr = ptr;
        InboundResultFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
      }
      __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        InboundResultFinalization.unregister(this);
        return ptr;
      }
      free() {
        const ptr = this.__destroy_into_raw();
        wasm2.__wbg_inboundresult_free(ptr, 0);
      }
      /**
       * @returns {string}
       */
      get plaintext() {
        let deferred1_0;
        let deferred1_1;
        try {
          const ret = wasm2.inboundresult_plaintext(this.__wbg_ptr);
          deferred1_0 = ret[0];
          deferred1_1 = ret[1];
          return getStringFromWasm02(ret[0], ret[1]);
        } finally {
          wasm2.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
      }
      /**
       * The peer's curve25519 identity key, extracted from the prekey
       * message body. Useful for on-prekey-message new-device discovery —
       * the SDK can use this to validate the sender against the cached
       * device list (or note a new device).
       * @returns {string}
       */
      get senderIdentityKey() {
        let deferred1_0;
        let deferred1_1;
        try {
          const ret = wasm2.inboundresult_senderIdentityKey(this.__wbg_ptr);
          deferred1_0 = ret[0];
          deferred1_1 = ret[1];
          return getStringFromWasm02(ret[0], ret[1]);
        } finally {
          wasm2.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
      }
      /**
       * Take ownership of the new session. Throws if called twice.
       * @returns {Session}
       */
      takeSession() {
        const ret = wasm2.inboundresult_takeSession(this.__wbg_ptr);
        if (ret[2]) {
          throw takeFromExternrefTable0(ret[1]);
        }
        return Session2.__wrap(ret[0]);
      }
    };
    if (Symbol.dispose) InboundResult.prototype[Symbol.dispose] = InboundResult.prototype.free;
    exports.InboundResult = InboundResult;
    var Session2 = class _Session {
      static __wrap(ptr) {
        const obj = Object.create(_Session.prototype);
        obj.__wbg_ptr = ptr;
        SessionFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
      }
      __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SessionFinalization.unregister(this);
        return ptr;
      }
      free() {
        const ptr = this.__destroy_into_raw();
        wasm2.__wbg_session_free(ptr, 0);
      }
      /**
       * Decrypt a message of the given type (0 = PreKey, 1 = Normal).
       * @param {number} message_type
       * @param {string} body
       * @returns {string}
       */
      decrypt(message_type, body) {
        let deferred3_0;
        let deferred3_1;
        try {
          const ptr0 = passStringToWasm0(body, wasm2.__wbindgen_malloc, wasm2.__wbindgen_realloc);
          const len0 = WASM_VECTOR_LEN2;
          const ret = wasm2.session_decrypt(this.__wbg_ptr, message_type, ptr0, len0);
          var ptr2 = ret[0];
          var len2 = ret[1];
          if (ret[3]) {
            ptr2 = 0;
            len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
          }
          deferred3_0 = ptr2;
          deferred3_1 = len2;
          return getStringFromWasm02(ptr2, len2);
        } finally {
          wasm2.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
      }
      /**
       * JSON string `{ "type": 0|1, "body": "<base64>" }`. Type 0 = PreKey,
       * 1 = Normal.
       * @param {string} plaintext
       * @returns {string}
       */
      encrypt(plaintext) {
        let deferred3_0;
        let deferred3_1;
        try {
          const ptr0 = passStringToWasm0(plaintext, wasm2.__wbindgen_malloc, wasm2.__wbindgen_realloc);
          const len0 = WASM_VECTOR_LEN2;
          const ret = wasm2.session_encrypt(this.__wbg_ptr, ptr0, len0);
          var ptr2 = ret[0];
          var len2 = ret[1];
          if (ret[3]) {
            ptr2 = 0;
            len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
          }
          deferred3_0 = ptr2;
          deferred3_1 = len2;
          return getStringFromWasm02(ptr2, len2);
        } finally {
          wasm2.__wbindgen_free(deferred3_0, deferred3_1, 1);
        }
      }
      /**
       * Restore from a JSON pickle produced by `pickle()`.
       * @param {string} pickle
       * @returns {Session}
       */
      static fromPickle(pickle) {
        const ptr0 = passStringToWasm0(pickle, wasm2.__wbindgen_malloc, wasm2.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN2;
        const ret = wasm2.session_fromPickle(ptr0, len0);
        if (ret[2]) {
          throw takeFromExternrefTable0(ret[1]);
        }
        return _Session.__wrap(ret[0]);
      }
      /**
       * @returns {boolean}
       */
      hasReceivedMessage() {
        const ret = wasm2.session_hasReceivedMessage(this.__wbg_ptr);
        return ret !== 0;
      }
      /**
       * Returns the JSON pickle string.
       * @returns {string}
       */
      pickle() {
        let deferred2_0;
        let deferred2_1;
        try {
          const ret = wasm2.session_pickle(this.__wbg_ptr);
          var ptr1 = ret[0];
          var len1 = ret[1];
          if (ret[3]) {
            ptr1 = 0;
            len1 = 0;
            throw takeFromExternrefTable0(ret[2]);
          }
          deferred2_0 = ptr1;
          deferred2_1 = len1;
          return getStringFromWasm02(ptr1, len1);
        } finally {
          wasm2.__wbindgen_free(deferred2_0, deferred2_1, 1);
        }
      }
      /**
       * @returns {string}
       */
      sessionId() {
        let deferred1_0;
        let deferred1_1;
        try {
          const ret = wasm2.session_sessionId(this.__wbg_ptr);
          deferred1_0 = ret[0];
          deferred1_1 = ret[1];
          return getStringFromWasm02(ret[0], ret[1]);
        } finally {
          wasm2.__wbindgen_free(deferred1_0, deferred1_1, 1);
        }
      }
    };
    if (Symbol.dispose) Session2.prototype[Symbol.dispose] = Session2.prototype.free;
    exports.Session = Session2;
    function module_start() {
      wasm2.module_start();
    }
    exports.module_start = module_start;
    function __wbg_get_imports2() {
      const import0 = {
        __proto__: null,
        __wbg___wbindgen_is_function_5cd60d5cf78b4eef: function(arg0) {
          const ret = typeof arg0 === "function";
          return ret;
        },
        __wbg___wbindgen_is_object_b4593df85baada48: function(arg0) {
          const val = arg0;
          const ret = typeof val === "object" && val !== null;
          return ret;
        },
        __wbg___wbindgen_is_string_dde0fd9020db4434: function(arg0) {
          const ret = typeof arg0 === "string";
          return ret;
        },
        __wbg___wbindgen_is_undefined_35bb9f4c7fd651d5: function(arg0) {
          const ret = arg0 === void 0;
          return ret;
        },
        __wbg___wbindgen_throw_9c31b086c2b26051: function(arg0, arg1) {
          throw new Error(getStringFromWasm02(arg0, arg1));
        },
        __wbg_call_dfde26266607c996: function() {
          return handleError(function(arg0, arg1, arg2) {
            const ret = arg0.call(arg1, arg2);
            return ret;
          }, arguments);
        },
        __wbg_crypto_38df2bab126b63dc: function(arg0) {
          const ret = arg0.crypto;
          return ret;
        },
        __wbg_getRandomValues_c44a50d8cfdaebeb: function() {
          return handleError(function(arg0, arg1) {
            arg0.getRandomValues(arg1);
          }, arguments);
        },
        __wbg_length_56fcd3e2b7e0299d: function(arg0) {
          const ret = arg0.length;
          return ret;
        },
        __wbg_msCrypto_bd5a034af96bcba6: function(arg0) {
          const ret = arg0.msCrypto;
          return ret;
        },
        __wbg_new_with_length_99887c91eae4abab: function(arg0) {
          const ret = new Uint8Array(arg0 >>> 0);
          return ret;
        },
        __wbg_node_84ea875411254db1: function(arg0) {
          const ret = arg0.node;
          return ret;
        },
        __wbg_process_44c7a14e11e9f69e: function(arg0) {
          const ret = arg0.process;
          return ret;
        },
        __wbg_prototypesetcall_5f9bdc8d75e07276: function(arg0, arg1, arg2) {
          Uint8Array.prototype.set.call(getArrayU8FromWasm02(arg0, arg1), arg2);
        },
        __wbg_randomFillSync_6c25eac9869eb53c: function() {
          return handleError(function(arg0, arg1) {
            arg0.randomFillSync(arg1);
          }, arguments);
        },
        __wbg_require_b4edbdcf3e2a1ef0: function() {
          return handleError(function() {
            const ret = module.require;
            return ret;
          }, arguments);
        },
        __wbg_static_accessor_GLOBAL_THIS_02344c9b09eb08a9: function() {
          const ret = typeof globalThis === "undefined" ? null : globalThis;
          return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_GLOBAL_ac6d4ac874d5cd54: function() {
          const ret = typeof global === "undefined" ? null : global;
          return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_SELF_9b2406c23aeb2023: function() {
          const ret = typeof self === "undefined" ? null : self;
          return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_static_accessor_WINDOW_b34d2126934e16ba: function() {
          const ret = typeof window === "undefined" ? null : window;
          return isLikeNone(ret) ? 0 : addToExternrefTable0(ret);
        },
        __wbg_subarray_7c6a0da8f3b4a1ba: function(arg0, arg1, arg2) {
          const ret = arg0.subarray(arg1 >>> 0, arg2 >>> 0);
          return ret;
        },
        __wbg_versions_276b2795b1c6a219: function(arg0) {
          const ret = arg0.versions;
          return ret;
        },
        __wbindgen_cast_0000000000000001: function(arg0, arg1) {
          const ret = getArrayU8FromWasm02(arg0, arg1);
          return ret;
        },
        __wbindgen_cast_0000000000000002: function(arg0, arg1) {
          const ret = getStringFromWasm02(arg0, arg1);
          return ret;
        },
        __wbindgen_init_externref_table: function() {
          const table = wasm2.__wbindgen_externrefs;
          const offset = table.grow(4);
          table.set(0, void 0);
          table.set(offset + 0, void 0);
          table.set(offset + 1, null);
          table.set(offset + 2, true);
          table.set(offset + 3, false);
        }
      };
      return {
        __proto__: null,
        "./kinsh_vodozemac_wasm_bg.js": import0
      };
    }
    var AccountFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
    }, unregister: () => {
    } } : new FinalizationRegistry((ptr) => wasm2.__wbg_account_free(ptr, 1));
    var GroupSessionFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
    }, unregister: () => {
    } } : new FinalizationRegistry((ptr) => wasm2.__wbg_groupsession_free(ptr, 1));
    var InboundGroupSessionFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
    }, unregister: () => {
    } } : new FinalizationRegistry((ptr) => wasm2.__wbg_inboundgroupsession_free(ptr, 1));
    var InboundResultFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
    }, unregister: () => {
    } } : new FinalizationRegistry((ptr) => wasm2.__wbg_inboundresult_free(ptr, 1));
    var SessionFinalization = typeof FinalizationRegistry === "undefined" ? { register: () => {
    }, unregister: () => {
    } } : new FinalizationRegistry((ptr) => wasm2.__wbg_session_free(ptr, 1));
    function addToExternrefTable0(obj) {
      const idx = wasm2.__externref_table_alloc();
      wasm2.__wbindgen_externrefs.set(idx, obj);
      return idx;
    }
    function getArrayU8FromWasm02(ptr, len) {
      ptr = ptr >>> 0;
      return getUint8ArrayMemory02().subarray(ptr / 1, ptr / 1 + len);
    }
    function getStringFromWasm02(ptr, len) {
      return decodeText2(ptr >>> 0, len);
    }
    var cachedUint8ArrayMemory02 = null;
    function getUint8ArrayMemory02() {
      if (cachedUint8ArrayMemory02 === null || cachedUint8ArrayMemory02.byteLength === 0) {
        cachedUint8ArrayMemory02 = new Uint8Array(wasm2.memory.buffer);
      }
      return cachedUint8ArrayMemory02;
    }
    function handleError(f, args) {
      try {
        return f.apply(this, args);
      } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm2.__wbindgen_exn_store(idx);
      }
    }
    function isLikeNone(x) {
      return x === void 0 || x === null;
    }
    function passStringToWasm0(arg, malloc, realloc) {
      if (realloc === void 0) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr2 = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory02().subarray(ptr2, ptr2 + buf.length).set(buf);
        WASM_VECTOR_LEN2 = buf.length;
        return ptr2;
      }
      let len = arg.length;
      let ptr = malloc(len, 1) >>> 0;
      const mem = getUint8ArrayMemory02();
      let offset = 0;
      for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 127) break;
        mem[ptr + offset] = code;
      }
      if (offset !== len) {
        if (offset !== 0) {
          arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory02().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);
        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
      }
      WASM_VECTOR_LEN2 = offset;
      return ptr;
    }
    function takeFromExternrefTable0(idx) {
      const value = wasm2.__wbindgen_externrefs.get(idx);
      wasm2.__externref_table_dealloc(idx);
      return value;
    }
    var cachedTextDecoder2 = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });
    cachedTextDecoder2.decode();
    function decodeText2(ptr, len) {
      return cachedTextDecoder2.decode(getUint8ArrayMemory02().subarray(ptr, ptr + len));
    }
    var cachedTextEncoder = new TextEncoder();
    if (!("encodeInto" in cachedTextEncoder)) {
      cachedTextEncoder.encodeInto = function(arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
          read: arg.length,
          written: buf.length
        };
      };
    }
    var WASM_VECTOR_LEN2 = 0;
    var wasmPath = `${__dirname}/kinsh_vodozemac_wasm_bg.wasm`;
    var wasmBytes = __require("fs").readFileSync(wasmPath);
    var wasmModule = new WebAssembly.Module(wasmBytes);
    var wasmInstance = new WebAssembly.Instance(wasmModule, __wbg_get_imports2());
    var wasm2 = wasmInstance.exports;
    wasm2.__wbindgen_start();
  }
});

// packages/service-protocol/src/validation.ts
var UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
var base64urlDecodedLength = (value) => {
  if (!BASE64URL_RE.test(value)) return Number.POSITIVE_INFINITY;
  return Math.floor(value.length * 3 / 4);
};
var standardBase64DecodedLength = (value) => {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 === 1) {
    return Number.POSITIVE_INFINITY;
  }
  try {
    return atob(value.padEnd(Math.ceil(value.length / 4) * 4, "=")).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};

// packages/service-protocol/src/sealed-sender.ts
var SEALED_SUITE = "OLM-V1-CURVE25519-AES256-HMAC-SHA256";
var SEALED_SENDER_PROTOCOL = "agents-city-sealed-sender/1";
var SEALED_DELIVERY_PROTOCOL = "agents-city-sealed-delivery/1";
var SEALED_CAPABILITY_GRANT_PROTOCOL = "agents-city-sealed-capability-grant/1";
var MAX_SEALED_SUBMISSION_BYTES = 24576;
var MAX_SEALED_CAPABILITIES_PER_BATCH = 32;
var DEFAULT_SEALED_CAPABILITY_POOL = 32;
var MAX_SEALED_CAPABILITIES_PER_ROAD = 128;
var MAX_SEALED_CAPABILITY_TTL_MS = 15 * 6e4;
var MIN_SEALED_CAPABILITY_TTL_MS = 3e4;
var SEALED_CAPABILITY_REFRESH_HORIZON_MS = 5 * 6e4;
var SEALED_CAPABILITY_REFRESH_INTERVAL_MS = 4 * 6e4;
var MAX_SEALED_MESSAGE_LIFETIME_MS = 60 * 6e4;
var exactRecord = (value, keys) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value;
  const actual = Object.keys(record);
  return actual.length === keys.length && actual.every((key) => keys.includes(key)) ? record : null;
};
var validToken = (value) => typeof value === "string" && base64urlDecodedLength(value) === 32;
var validTag = (value) => typeof value === "string" && base64urlDecodedLength(value) === 24;
var parsePayload = (value) => {
  const payload = exactRecord(value, ["suite", "messageType", "ciphertext"]);
  if (!payload || payload.suite !== SEALED_SUITE || ![0, 1].includes(Number(payload.messageType)) || typeof payload.ciphertext !== "string" || standardBase64DecodedLength(payload.ciphertext) < 17 || standardBase64DecodedLength(payload.ciphertext) > 16384) return null;
  return {
    suite: SEALED_SUITE,
    messageType: Number(payload.messageType),
    ciphertext: payload.ciphertext
  };
};
var parseSealedCapability = (value, now = Date.now()) => {
  const capability = exactRecord(value, ["token", "receiptTag", "channelTag", "expiresAt"]);
  if (!capability || !validToken(capability.token) || !validTag(capability.receiptTag) || !validTag(capability.channelTag) || !Number.isSafeInteger(capability.expiresAt) || Number(capability.expiresAt) <= now || Number(capability.expiresAt) - now > MAX_SEALED_CAPABILITY_TTL_MS) return null;
  return capability;
};
var parseSealedCapabilityRegistration = (value, now = Date.now()) => {
  const capability = exactRecord(value, ["tokenHash", "receiptTag", "channelTag", "expiresAt"]);
  if (!capability || !validToken(capability.tokenHash) || !validTag(capability.receiptTag) || !validTag(capability.channelTag) || !Number.isSafeInteger(capability.expiresAt) || Number(capability.expiresAt) - now < MIN_SEALED_CAPABILITY_TTL_MS || Number(capability.expiresAt) - now > MAX_SEALED_CAPABILITY_TTL_MS) return null;
  return capability;
};
var parseSealedSubmission = (value) => {
  const submission = exactRecord(value, ["protocol", "id", "capability", "payload"]);
  const payload = submission ? parsePayload(submission.payload) : null;
  if (!submission || submission.protocol !== SEALED_SENDER_PROTOCOL || typeof submission.id !== "string" || !UUID_RE.test(submission.id) || !validToken(submission.capability) || !payload) return null;
  return {
    protocol: SEALED_SENDER_PROTOCOL,
    id: submission.id,
    capability: submission.capability,
    payload
  };
};
var parseSealedDelivery = (value, now = Date.now()) => {
  const delivery = exactRecord(value, [
    "protocol",
    "id",
    "receiptTag",
    "receivedAt",
    "expiresAt",
    "payload"
  ]);
  const payload = delivery ? parsePayload(delivery.payload) : null;
  if (!delivery || delivery.protocol !== SEALED_DELIVERY_PROTOCOL || typeof delivery.id !== "string" || !UUID_RE.test(delivery.id) || !validTag(delivery.receiptTag) || !Number.isSafeInteger(delivery.receivedAt) || Number(delivery.receivedAt) > now + 9e4 || !Number.isSafeInteger(delivery.expiresAt) || Number(delivery.expiresAt) <= now || Number(delivery.expiresAt) - Number(delivery.receivedAt) > MAX_SEALED_MESSAGE_LIFETIME_MS || !payload) return null;
  return {
    protocol: SEALED_DELIVERY_PROTOCOL,
    id: delivery.id,
    receiptTag: delivery.receiptTag,
    receivedAt: Number(delivery.receivedAt),
    expiresAt: Number(delivery.expiresAt),
    payload
  };
};

// packages/service-protocol/src/hybrid-establishment.ts
var HYBRID_ESTABLISHMENT_PROTOCOL = "agents-city-hybrid-establishment/1";
var HYBRID_PREKEY_PROTOCOL = "agents-city-hybrid-prekey/1";
var HYBRID_ESTABLISHMENT_SUITE = "AC-HYBRID-X25519-MLKEM768-HKDFSHA256-AES256GCM-OLMV1";
var MLKEM768_PUBLIC_KEY_BYTES = 1184;
var MLKEM768_SEED_BYTES = 64;
var HYBRID_NONCE_BYTES = 12;
var exactRecord2 = (value, keys) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value;
  const actual = Object.keys(record);
  return actual.length === keys.length && actual.every((key) => keys.includes(key)) ? record : null;
};
var canonicalHybridPrekeyRecord = (record) => {
  if (record.protocol !== HYBRID_PREKEY_PROTOCOL || record.suite !== HYBRID_ESTABLISHMENT_SUITE || !/^[A-Za-z0-9_-]{16,64}$/.test(record.keyId) || base64urlDecodedLength(record.publicKey) !== MLKEM768_PUBLIC_KEY_BYTES || base64urlDecodedLength(record.signingKeyId) !== 32 || !Number.isSafeInteger(record.keyVersion) || record.keyVersion < 1) throw new Error("invalid_hybrid_prekey");
  return [
    record.protocol,
    record.suite,
    record.keyId,
    record.publicKey,
    record.signingKeyId,
    String(record.keyVersion)
  ].join("\n");
};
var parseSignedHybridPrekey = (value) => {
  const signed = exactRecord2(value, ["record", "signature"]);
  const candidate = signed ? exactRecord2(signed.record, [
    "protocol",
    "suite",
    "keyId",
    "publicKey",
    "signingKeyId",
    "keyVersion"
  ]) : null;
  if (!signed || !candidate || typeof signed.signature !== "string") return null;
  const record = {
    protocol: candidate.protocol,
    suite: candidate.suite,
    keyId: String(candidate.keyId ?? ""),
    publicKey: String(candidate.publicKey ?? ""),
    signingKeyId: String(candidate.signingKeyId ?? ""),
    keyVersion: Number(candidate.keyVersion)
  };
  try {
    canonicalHybridPrekeyRecord(record);
  } catch {
    return null;
  }
  if (base64urlDecodedLength(signed.signature) !== 64) return null;
  return { record, signature: signed.signature };
};
var canonicalHybridTranscript = (fields) => {
  const payload = fields.payload;
  if (fields.relayProtocol.length < 1 || !UUID_RE.test(fields.id) || !UUID_RE.test(fields.requestId) || !UUID_RE.test(fields.roadId) || !Number.isSafeInteger(fields.roadRevision) || fields.roadRevision < 1 || !Number.isSafeInteger(fields.createdAt) || fields.createdAt < 0 || !Number.isSafeInteger(fields.expiresAt) || fields.expiresAt <= fields.createdAt || !UUID_RE.test(fields.senderDeviceId) || !Number.isSafeInteger(fields.senderKeyVersion) || fields.senderKeyVersion < 1 || payload.suite !== HYBRID_ESTABLISHMENT_SUITE || base64urlDecodedLength(payload.recipientKeyId) !== 32 || payload.messageType !== 0 || !/^[A-Za-z0-9_-]{16,64}$/.test(payload.pqPrekeyId) || base64urlDecodedLength(payload.pqPrekeyHash) !== 32 || base64urlDecodedLength(payload.ephemeralKey) !== 32 || base64urlDecodedLength(payload.nonce) !== HYBRID_NONCE_BYTES) throw new Error("invalid_hybrid_transcript");
  return [
    HYBRID_ESTABLISHMENT_PROTOCOL,
    fields.relayProtocol,
    fields.id,
    fields.requestId,
    fields.roadId,
    String(fields.roadRevision),
    fields.from,
    fields.to,
    String(fields.createdAt),
    String(fields.expiresAt),
    fields.senderDeviceId,
    String(fields.senderKeyVersion),
    payload.suite,
    payload.recipientKeyId,
    String(payload.messageType),
    payload.pqPrekeyId,
    payload.pqPrekeyHash,
    payload.ephemeralKey,
    payload.nonce
  ].join("\n");
};

// packages/service-protocol/src/key-transparency.ts
var KEY_TRANSPARENCY_PROTOCOL = "agents-city-key-transparency/1";
var KEY_TRANSPARENCY_RECORD_PROTOCOL = "agents-city-device-key-record/1";
var KEY_TRANSPARENCY_LOG_ENTRY_PROTOCOL = "agents-city-key-log-entry/1";
var KEY_TRANSPARENCY_HEAD_PROTOCOL = "agents-city-key-log-head/1";
var KEY_TRANSPARENCY_WITNESS_PROTOCOL = "agents-city-key-log-witness/1";
var KEY_TRANSPARENCY_CONTEXT = "agents-city/key-transparency/v1";
var SPARSE_MERKLE_DEPTH = 256;
var asExactRecord = (value, keys, error) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(error);
  const record = value;
  const actual = Object.keys(record);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    throw new Error(error);
  }
  return record;
};
var parsePublicOkp = (value, curve) => {
  const record = asExactRecord(value, ["kty", "crv", "x", "ext"], "invalid_public_jwk");
  if (record.kty !== "OKP" || record.crv !== curve || typeof record.x !== "string" || base64urlDecodedLength(record.x) !== 32 || record.ext !== true) throw new Error("invalid_public_jwk");
  return { kty: "OKP", crv: curve, x: record.x, ext: true };
};
var parseDeviceKeyRecord = (value) => {
  const record = asExactRecord(value, [
    "protocol",
    "deviceId",
    "deviceVersion",
    "keyVersion",
    "status",
    "authorization",
    "signingPublicJwk",
    "encryptionPublicJwk",
    "signingThumbprint",
    "encryptionThumbprint",
    "ratchetIdentityKey",
    "ratchetSigningKey",
    "establishmentSuites",
    "previousRecordHash",
    "publishedAt"
  ], "invalid_device_key_record");
  if (typeof record.protocol !== "string" || typeof record.deviceId !== "string" || typeof record.deviceVersion !== "number" || typeof record.keyVersion !== "number" || typeof record.status !== "string" || typeof record.authorization !== "string" || typeof record.signingThumbprint !== "string" || typeof record.encryptionThumbprint !== "string" || typeof record.ratchetIdentityKey !== "string" || typeof record.ratchetSigningKey !== "string" || !Array.isArray(record.establishmentSuites) || !record.establishmentSuites.every((suite) => typeof suite === "string") || record.previousRecordHash !== null && typeof record.previousRecordHash !== "string" || typeof record.publishedAt !== "number") throw new Error("invalid_device_key_record");
  const parsed = {
    protocol: record.protocol,
    deviceId: record.deviceId,
    deviceVersion: record.deviceVersion,
    keyVersion: record.keyVersion,
    status: record.status,
    authorization: record.authorization,
    signingPublicJwk: parsePublicOkp(record.signingPublicJwk, "Ed25519"),
    encryptionPublicJwk: parsePublicOkp(record.encryptionPublicJwk, "X25519"),
    signingThumbprint: record.signingThumbprint,
    encryptionThumbprint: record.encryptionThumbprint,
    ratchetIdentityKey: record.ratchetIdentityKey,
    ratchetSigningKey: record.ratchetSigningKey,
    establishmentSuites: [...record.establishmentSuites],
    previousRecordHash: record.previousRecordHash,
    publishedAt: record.publishedAt
  };
  canonicalDeviceKeyRecord(parsed);
  return parsed;
};
var parseDeviceKeyRecordPublication = (value) => {
  const publication = asExactRecord(value, [
    "record",
    "deviceSignature",
    "previousDeviceSignature",
    "recoveryEventId"
  ], "invalid_device_publication");
  for (const field of ["deviceSignature", "previousDeviceSignature"]) {
    if (publication[field] !== null && (typeof publication[field] !== "string" || base64urlDecodedLength(publication[field]) !== 64)) throw new Error("invalid_device_publication");
  }
  if (publication.recoveryEventId !== null && (typeof publication.recoveryEventId !== "string" || !UUID_RE.test(publication.recoveryEventId))) throw new Error("invalid_device_publication");
  return {
    record: parseDeviceKeyRecord(publication.record),
    deviceSignature: publication.deviceSignature,
    previousDeviceSignature: publication.previousDeviceSignature,
    recoveryEventId: publication.recoveryEventId
  };
};
var parseKeyLogEntry = (value) => {
  const entry = asExactRecord(value, [
    "protocol",
    "sequence",
    "timestamp",
    "mapRoot",
    "previousMapRoot",
    "previousEntryHash"
  ], "invalid_key_log_entry");
  if (typeof entry.protocol !== "string" || typeof entry.sequence !== "number" || typeof entry.timestamp !== "number" || typeof entry.mapRoot !== "string" || typeof entry.previousMapRoot !== "string" || entry.previousEntryHash !== null && typeof entry.previousEntryHash !== "string") throw new Error("invalid_key_log_entry");
  const parsed = {
    protocol: entry.protocol,
    sequence: entry.sequence,
    timestamp: entry.timestamp,
    mapRoot: entry.mapRoot,
    previousMapRoot: entry.previousMapRoot,
    previousEntryHash: entry.previousEntryHash
  };
  canonicalKeyLogEntry(parsed);
  return parsed;
};
var parseKeyLogWitness = (value) => {
  const witness = asExactRecord(value, [
    "protocol",
    "keyId",
    "signedAt",
    "signature"
  ], "invalid_key_log_witness");
  if (witness.protocol !== KEY_TRANSPARENCY_WITNESS_PROTOCOL || typeof witness.keyId !== "string" || !/^[A-Za-z0-9._-]{1,80}$/.test(witness.keyId) || typeof witness.signedAt !== "number" || !Number.isSafeInteger(witness.signedAt) || witness.signedAt < 0 || typeof witness.signature !== "string" || base64urlDecodedLength(witness.signature) !== 64) throw new Error("invalid_key_log_witness");
  return {
    protocol: KEY_TRANSPARENCY_WITNESS_PROTOCOL,
    keyId: witness.keyId,
    signedAt: witness.signedAt,
    signature: witness.signature
  };
};
var parseKeyLogHead = (value) => {
  const head = asExactRecord(value, [
    "protocol",
    "treeSize",
    "root",
    "mapRoot",
    "timestamp",
    "operatorKeyId",
    "operatorSignature",
    "witnesses"
  ], "invalid_key_log_head");
  if (typeof head.protocol !== "string" || typeof head.treeSize !== "number" || typeof head.root !== "string" || typeof head.mapRoot !== "string" || typeof head.timestamp !== "number" || typeof head.operatorKeyId !== "string" || typeof head.operatorSignature !== "string" || base64urlDecodedLength(head.operatorSignature) !== 64 || !Array.isArray(head.witnesses) || head.witnesses.length > 16) throw new Error("invalid_key_log_head");
  const parsed = {
    protocol: head.protocol,
    treeSize: head.treeSize,
    root: head.root,
    mapRoot: head.mapRoot,
    timestamp: head.timestamp,
    operatorKeyId: head.operatorKeyId,
    operatorSignature: head.operatorSignature,
    witnesses: head.witnesses.map(parseKeyLogWitness)
  };
  canonicalKeyLogHead(parsed);
  return parsed;
};
var parseSparseMerkleProof = (value) => {
  const proof = asExactRecord(value, ["key", "siblings"], "invalid_sparse_merkle_proof");
  if (typeof proof.key !== "string" || base64urlDecodedLength(proof.key) !== 32 || !Array.isArray(proof.siblings) || proof.siblings.length > SPARSE_MERKLE_DEPTH) throw new Error("invalid_sparse_merkle_proof");
  return {
    key: proof.key,
    siblings: proof.siblings.map((value2) => {
      const sibling = asExactRecord(value2, ["height", "hash"], "invalid_sparse_merkle_proof");
      if (typeof sibling.height !== "number" || !Number.isInteger(sibling.height) || sibling.height < 0 || sibling.height >= SPARSE_MERKLE_DEPTH || typeof sibling.hash !== "string" || base64urlDecodedLength(sibling.hash) !== 32) throw new Error("invalid_sparse_merkle_proof");
      return { height: sibling.height, hash: sibling.hash };
    })
  };
};
var parseKeyTransparencyQuery = (value) => {
  const query = asExactRecord(value, [
    "protocol",
    "record",
    "publication",
    "recordHistory",
    "mapProof",
    "logEntry",
    "logEntryIndex",
    "logInclusionProof",
    "logFrontier",
    "entriesSinceLastHead",
    "head"
  ], "invalid_key_transparency_query");
  if (query.protocol !== KEY_TRANSPARENCY_PROTOCOL || query.record !== null && typeof query.record !== "object" || query.publication !== null && typeof query.publication !== "object" || !Array.isArray(query.recordHistory) || query.recordHistory.length > 64 || typeof query.logEntryIndex !== "number" || !Number.isSafeInteger(query.logEntryIndex) || query.logEntryIndex < 0 || !Array.isArray(query.logInclusionProof) || query.logInclusionProof.length > 54 || !query.logInclusionProof.every((hash) => typeof hash === "string" && base64urlDecodedLength(hash) === 32) || !Array.isArray(query.logFrontier) || query.logFrontier.length > 54 || !query.logFrontier.every((hash) => hash === null || typeof hash === "string" && base64urlDecodedLength(hash) === 32) || !Array.isArray(query.entriesSinceLastHead) || query.entriesSinceLastHead.length > 1024) throw new Error("invalid_key_transparency_query");
  return {
    protocol: KEY_TRANSPARENCY_PROTOCOL,
    record: query.record === null ? null : parseDeviceKeyRecord(query.record),
    publication: query.publication === null ? null : parseDeviceKeyRecordPublication(query.publication),
    recordHistory: query.recordHistory.map(parseDeviceKeyRecordPublication),
    mapProof: parseSparseMerkleProof(query.mapProof),
    logEntry: parseKeyLogEntry(query.logEntry),
    logEntryIndex: query.logEntryIndex,
    logInclusionProof: [...query.logInclusionProof],
    logFrontier: [...query.logFrontier],
    entriesSinceLastHead: query.entriesSinceLastHead.map(parseKeyLogEntry),
    head: parseKeyLogHead(query.head)
  };
};
var encoder = new TextEncoder();
var bytesToBase64url = (value) => {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};
var base64urlToBytes = (value) => {
  if (!BASE64URL_RE.test(value)) throw new Error("invalid_base64url");
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};
var concatBytes = (...values) => {
  const result = new Uint8Array(values.reduce((total, value) => total + value.byteLength, 0));
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.byteLength;
  }
  return result;
};
var sha256 = async (value) => new Uint8Array(
  await crypto.subtle.digest("SHA-256", value.slice().buffer)
);
var sha256Base64url = async (value) => bytesToBase64url(await sha256(value));
var canonicalOkp = (value, curve) => {
  if (value.kty !== "OKP" || value.crv !== curve || value.ext !== true || typeof value.x !== "string" || base64urlDecodedLength(value.x) !== 32 || value.d !== void 0) throw new Error(`invalid_${curve.toLowerCase()}_public_key`);
  return ["OKP", curve, value.x, "true"].join(":");
};
var validSuite = (value) => /^[A-Z0-9][A-Z0-9-]{2,127}$/.test(value);
var canonicalDeviceKeyRecord = (record) => {
  if (record.protocol !== KEY_TRANSPARENCY_RECORD_PROTOCOL || !UUID_RE.test(record.deviceId) || !Number.isSafeInteger(record.deviceVersion) || record.deviceVersion < 1 || !Number.isSafeInteger(record.keyVersion) || record.keyVersion < 1 || !["active", "revoked"].includes(record.status) || !["device", "account-recovery"].includes(record.authorization) || base64urlDecodedLength(record.signingThumbprint) !== 32 || base64urlDecodedLength(record.encryptionThumbprint) !== 32 || standardBase64DecodedLength(record.ratchetIdentityKey) !== 32 || standardBase64DecodedLength(record.ratchetSigningKey) !== 32 || !Array.isArray(record.establishmentSuites) || record.establishmentSuites.length < 1 || record.establishmentSuites.length > 8 || !record.establishmentSuites.every(validSuite) || new Set(record.establishmentSuites).size !== record.establishmentSuites.length || [...record.establishmentSuites].sort().some((suite, index) => suite !== record.establishmentSuites[index]) || record.previousRecordHash !== null && base64urlDecodedLength(record.previousRecordHash) !== 32 || !Number.isSafeInteger(record.publishedAt) || record.publishedAt < 0) throw new Error("invalid_device_key_record");
  return [
    record.protocol,
    record.deviceId,
    String(record.deviceVersion),
    String(record.keyVersion),
    record.status,
    record.authorization,
    canonicalOkp(record.signingPublicJwk, "Ed25519"),
    canonicalOkp(record.encryptionPublicJwk, "X25519"),
    record.signingThumbprint,
    record.encryptionThumbprint,
    record.ratchetIdentityKey,
    record.ratchetSigningKey,
    record.establishmentSuites.join(","),
    record.previousRecordHash ?? "-",
    String(record.publishedAt)
  ].join("\n");
};
var hashDeviceKeyRecord = async (record) => sha256Base64url(
  encoder.encode(canonicalDeviceKeyRecord(record))
);
var okpJwkThumbprint = async (jwk, curve) => {
  canonicalOkp(jwk, curve);
  return sha256Base64url(encoder.encode(JSON.stringify({ crv: curve, kty: "OKP", x: jwk.x })));
};
var deviceTransparencyMapKey = async (deviceId) => {
  if (!UUID_RE.test(deviceId)) throw new Error("invalid_device_id");
  return sha256Base64url(encoder.encode(`${KEY_TRANSPARENCY_CONTEXT}\0device\0${deviceId.toLowerCase()}`));
};
var mapLeafHashBytes = async (key, recordHash) => sha256(
  concatBytes(Uint8Array.of(0), key, recordHash)
);
var nodeHashBytes = async (left, right) => sha256(
  concatBytes(Uint8Array.of(1), left, right)
);
var defaultSparseHashesPromise = null;
var defaultSparseMerkleHashes = () => {
  defaultSparseHashesPromise ??= (async () => {
    const hashes = [await sha256(Uint8Array.of(0))];
    for (let height = 1; height <= SPARSE_MERKLE_DEPTH; height += 1) {
      hashes.push(await nodeHashBytes(hashes[height - 1], hashes[height - 1]));
    }
    return hashes;
  })();
  return defaultSparseHashesPromise;
};
var bitAt = (bytes, bit) => bytes[Math.floor(bit / 8)] >> 7 - bit % 8 & 1;
var sparseMerkleLeafHash = async (key, record) => {
  if (base64urlDecodedLength(key) !== 32) throw new Error("invalid_map_key");
  if (!record) return bytesToBase64url((await defaultSparseMerkleHashes())[0]);
  return bytesToBase64url(await mapLeafHashBytes(
    base64urlToBytes(key),
    base64urlToBytes(await hashDeviceKeyRecord(record))
  ));
};
var sparseMerkleRoot = async (key, record, siblings) => {
  const keyBytes = base64urlToBytes(key);
  if (keyBytes.byteLength !== 32) throw new Error("invalid_map_key");
  if (siblings.length > SPARSE_MERKLE_DEPTH || siblings.some(({ height, hash }) => !Number.isInteger(height) || height < 0 || height >= SPARSE_MERKLE_DEPTH || base64urlDecodedLength(hash) !== 32) || new Set(siblings.map(({ height }) => height)).size !== siblings.length) throw new Error("invalid_sparse_merkle_proof");
  const provided = new Map(siblings.map(({ height, hash }) => [height, base64urlToBytes(hash)]));
  const defaults = await defaultSparseMerkleHashes();
  let current = base64urlToBytes(await sparseMerkleLeafHash(key, record));
  for (let height = 0; height < SPARSE_MERKLE_DEPTH; height += 1) {
    const sibling = provided.get(height) ?? defaults[height];
    const branch = bitAt(keyBytes, SPARSE_MERKLE_DEPTH - 1 - height);
    current = branch === 0 ? await nodeHashBytes(current, sibling) : await nodeHashBytes(sibling, current);
  }
  return bytesToBase64url(current);
};
var verifySparseMerkleProof = async (expectedRoot, record, proof) => {
  if (base64urlDecodedLength(expectedRoot) !== 32) return false;
  try {
    if (record && await deviceTransparencyMapKey(record.deviceId) !== proof.key) return false;
    return await sparseMerkleRoot(proof.key, record, proof.siblings) === expectedRoot;
  } catch {
    return false;
  }
};
var canonicalKeyLogEntry = (entry) => {
  if (entry.protocol !== KEY_TRANSPARENCY_LOG_ENTRY_PROTOCOL || !Number.isSafeInteger(entry.sequence) || entry.sequence < 1 || !Number.isSafeInteger(entry.timestamp) || entry.timestamp < 0 || base64urlDecodedLength(entry.mapRoot) !== 32 || base64urlDecodedLength(entry.previousMapRoot) !== 32 || entry.previousEntryHash !== null && base64urlDecodedLength(entry.previousEntryHash) !== 32) throw new Error("invalid_key_log_entry");
  return [
    entry.protocol,
    String(entry.sequence),
    String(entry.timestamp),
    entry.mapRoot,
    entry.previousMapRoot,
    entry.previousEntryHash ?? "-"
  ].join("\n");
};
var hashKeyLogEntry = async (entry) => sha256Base64url(
  encoder.encode(canonicalKeyLogEntry(entry))
);
var rfc6962LeafHash = async (canonicalLeaf) => sha256Base64url(
  concatBytes(Uint8Array.of(0), encoder.encode(canonicalLeaf))
);
var rfc6962NodeHash = async (left, right) => {
  if (base64urlDecodedLength(left) !== 32 || base64urlDecodedLength(right) !== 32) {
    throw new Error("invalid_log_node");
  }
  return bytesToBase64url(await nodeHashBytes(base64urlToBytes(left), base64urlToBytes(right)));
};
var keyLogLeafHash = (entry) => rfc6962LeafHash(canonicalKeyLogEntry(entry));
var logRootFromFrontier = async (frontier) => {
  if (frontier.length > 54) throw new Error("invalid_log_frontier");
  let root = null;
  for (const hash of frontier) {
    if (hash === null) continue;
    if (base64urlDecodedLength(hash) !== 32) throw new Error("invalid_log_frontier");
    root = root === null ? hash : await rfc6962NodeHash(hash, root);
  }
  if (root === null) throw new Error("empty_log_frontier");
  return root;
};
var appendKeyLogFrontier = async (current, treeSize, leafHash) => {
  if (!Number.isSafeInteger(treeSize) || treeSize < 0 || base64urlDecodedLength(leafHash) !== 32) {
    throw new Error("invalid_log_append");
  }
  const frontier = [...current];
  let carry = leafHash;
  let cursor = treeSize;
  let level = 0;
  while ((cursor & 1) === 1) {
    const left = frontier[level];
    if (!left) throw new Error("invalid_log_frontier");
    carry = await rfc6962NodeHash(left, carry);
    frontier[level] = null;
    cursor = Math.floor(cursor / 2);
    level += 1;
  }
  frontier[level] = carry;
  while (frontier.length && frontier[frontier.length - 1] === null) frontier.pop();
  return { frontier, root: await logRootFromFrontier(frontier), treeSize: treeSize + 1 };
};
var verifyRfc6962Inclusion = async (leafIndex, treeSize, leafHash, proof, expectedRoot) => {
  if (!Number.isSafeInteger(leafIndex) || !Number.isSafeInteger(treeSize) || leafIndex < 0 || treeSize < 1 || leafIndex >= treeSize || base64urlDecodedLength(leafHash) !== 32 || base64urlDecodedLength(expectedRoot) !== 32 || proof.length > 54 || proof.some((hash) => base64urlDecodedLength(hash) !== 32)) return false;
  let fn = leafIndex;
  let sn = treeSize - 1;
  let root = leafHash;
  for (const sibling of proof) {
    if ((fn & 1) === 1 || fn === sn) {
      root = await rfc6962NodeHash(sibling, root);
      while ((fn & 1) === 0 && fn !== 0) {
        fn = Math.floor(fn / 2);
        sn = Math.floor(sn / 2);
      }
    } else {
      root = await rfc6962NodeHash(root, sibling);
    }
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }
  return sn === 0 && root === expectedRoot;
};
var canonicalKeyLogHead = (head) => {
  if (head.protocol !== KEY_TRANSPARENCY_HEAD_PROTOCOL || !Number.isSafeInteger(head.treeSize) || head.treeSize < 1 || base64urlDecodedLength(head.root) !== 32 || base64urlDecodedLength(head.mapRoot) !== 32 || !Number.isSafeInteger(head.timestamp) || head.timestamp < 0 || !/^[A-Za-z0-9._-]{1,80}$/.test(head.operatorKeyId)) throw new Error("invalid_key_log_head");
  return [
    head.protocol,
    String(head.treeSize),
    head.root,
    head.mapRoot,
    String(head.timestamp),
    head.operatorKeyId
  ].join("\n");
};
var canonicalWitnessAttestation = (head, witness) => {
  if (witness.protocol !== KEY_TRANSPARENCY_WITNESS_PROTOCOL || !/^[A-Za-z0-9._-]{1,80}$/.test(witness.keyId) || !Number.isSafeInteger(witness.signedAt) || witness.signedAt < head.timestamp) throw new Error("invalid_key_log_witness");
  return [
    canonicalKeyLogHead(head),
    witness.protocol,
    witness.keyId,
    String(witness.signedAt)
  ].join("\n");
};
var verifyEd25519 = async (jwk, message, signature) => {
  try {
    if (base64urlDecodedLength(signature) !== 64) return false;
    const key = await crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, false, ["verify"]);
    return crypto.subtle.verify(
      "Ed25519",
      key,
      base64urlToBytes(signature),
      encoder.encode(message)
    );
  } catch {
    return false;
  }
};
var verifyKeyLogHead = async (head, trust, now = Date.now()) => {
  try {
    head = parseKeyLogHead(head);
    if (head.operatorKeyId !== trust.operatorKeyId || now - head.timestamp > trust.maximumHeadAgeMs || head.timestamp > now + 9e4 || !Number.isInteger(trust.minimumWitnesses) || trust.minimumWitnesses < 0) return false;
    if (!await verifyEd25519(
      trust.operatorSigningPublicJwk,
      canonicalKeyLogHead(head),
      head.operatorSignature
    )) return false;
    const unique = /* @__PURE__ */ new Set();
    for (const witness of head.witnesses) {
      if (unique.has(witness.keyId)) return false;
      const key = trust.witnessKeys[witness.keyId];
      if (!key || witness.signedAt - head.timestamp > trust.maximumWitnessLagMs) continue;
      if (!await verifyEd25519(
        key,
        canonicalWitnessAttestation(head, witness),
        witness.signature
      )) continue;
      unique.add(witness.keyId);
    }
    return unique.size >= trust.minimumWitnesses;
  } catch {
    return false;
  }
};
var verifyDevicePublication = async (publication, previous = null) => {
  try {
    publication = parseDeviceKeyRecordPublication(publication);
    previous = previous === null ? null : parseDeviceKeyRecord(previous);
    const canonical = canonicalDeviceKeyRecord(publication.record);
    if (publication.record.signingThumbprint !== await okpJwkThumbprint(
      publication.record.signingPublicJwk,
      "Ed25519"
    ) || publication.record.encryptionThumbprint !== await okpJwkThumbprint(
      publication.record.encryptionPublicJwk,
      "X25519"
    )) return false;
    if (previous === null) {
      if (publication.record.deviceVersion !== 1 || publication.record.previousRecordHash !== null || publication.record.status !== "active" || publication.record.authorization !== "device" || publication.previousDeviceSignature !== null) return false;
    } else if (publication.record.deviceId !== previous.deviceId || publication.record.deviceVersion !== previous.deviceVersion + 1 || publication.record.previousRecordHash !== await hashDeviceKeyRecord(previous) || previous.status === "revoked" || publication.record.keyVersion < previous.keyVersion) return false;
    if (publication.record.authorization === "device") {
      if (publication.record.status !== "active" || publication.recoveryEventId !== null) return false;
      if (typeof publication.deviceSignature !== "string" || !await verifyEd25519(
        publication.record.signingPublicJwk,
        canonical,
        publication.deviceSignature
      )) return false;
      if (previous === null) return publication.previousDeviceSignature === null;
      return typeof publication.previousDeviceSignature === "string" && await verifyEd25519(
        previous.signingPublicJwk,
        canonical,
        publication.previousDeviceSignature
      );
    }
    return publication.deviceSignature === null && publication.previousDeviceSignature === null && publication.record.status === "revoked" && previous !== null && typeof publication.recoveryEventId === "string" && UUID_RE.test(publication.recoveryEventId);
  } catch {
    return false;
  }
};
var stateFromInitialQuery = async (query) => {
  const entryHash = await hashKeyLogEntry(query.logEntry);
  if (query.entriesSinceLastHead.length !== 0 || query.logEntry.sequence !== query.head.treeSize || query.logEntryIndex !== query.head.treeSize - 1 || query.logEntry.mapRoot !== query.head.mapRoot || await logRootFromFrontier(query.logFrontier) !== query.head.root || !await verifyRfc6962Inclusion(
    query.logEntryIndex,
    query.head.treeSize,
    await keyLogLeafHash(query.logEntry),
    query.logInclusionProof,
    query.head.root
  )) throw new Error("invalid_initial_log_view");
  return {
    treeSize: query.head.treeSize,
    root: query.head.root,
    mapRoot: query.head.mapRoot,
    frontier: [...query.logFrontier],
    lastEntryHash: entryHash,
    timestamp: query.head.timestamp
  };
};
var advanceState = async (previous, entries, head) => {
  let state = { ...previous, frontier: [...previous.frontier] };
  for (const entry of entries) {
    if (entry.sequence !== state.treeSize + 1 || entry.previousMapRoot !== state.mapRoot || entry.previousEntryHash !== state.lastEntryHash || entry.timestamp < state.timestamp) throw new Error("key_log_fork_or_gap");
    const appended = await appendKeyLogFrontier(
      state.frontier,
      state.treeSize,
      await keyLogLeafHash(entry)
    );
    state = {
      treeSize: appended.treeSize,
      root: appended.root,
      mapRoot: entry.mapRoot,
      frontier: appended.frontier,
      lastEntryHash: await hashKeyLogEntry(entry),
      timestamp: entry.timestamp
    };
  }
  if (state.treeSize !== head.treeSize || state.root !== head.root || state.mapRoot !== head.mapRoot || state.timestamp > head.timestamp) throw new Error("key_log_head_mismatch");
  return state;
};
var verifyKeyTransparencyQuery = async (deviceId, query, trust, previous = null, now = Date.now()) => {
  query = parseKeyTransparencyQuery(query);
  if (query.protocol !== KEY_TRANSPARENCY_PROTOCOL || !UUID_RE.test(deviceId) || query.mapProof.key !== await deviceTransparencyMapKey(deviceId) || (query.record?.deviceId ?? deviceId) !== deviceId || query.record === null !== (query.publication === null) || !Array.isArray(query.recordHistory) || query.recordHistory.length > 64 || query.record === null && query.recordHistory.length !== 0 || query.record !== null && query.recordHistory.length < 1 || query.publication !== null && query.record !== null && canonicalDeviceKeyRecord(query.publication.record) !== canonicalDeviceKeyRecord(query.record) || !await verifyKeyLogHead(query.head, trust, now) || !await verifySparseMerkleProof(query.head.mapRoot, query.record, query.mapProof)) throw new Error("invalid_key_transparency_query");
  let previousRecord = null;
  for (const publication of query.recordHistory) {
    if (!await verifyDevicePublication(publication, previousRecord)) {
      throw new Error("invalid_key_transparency_history");
    }
    previousRecord = publication.record;
  }
  if (query.record === null && previousRecord !== null || query.record !== null && previousRecord === null || query.record !== null && previousRecord !== null && canonicalDeviceKeyRecord(query.record) !== canonicalDeviceKeyRecord(previousRecord) || query.publication !== null && query.recordHistory.length > 0 && (() => {
    const latest = query.recordHistory.at(-1);
    return canonicalDeviceKeyRecord(query.publication.record) !== canonicalDeviceKeyRecord(latest.record) || query.publication.deviceSignature !== latest.deviceSignature || query.publication.previousDeviceSignature !== latest.previousDeviceSignature || query.publication.recoveryEventId !== latest.recoveryEventId;
  })()) throw new Error("invalid_key_transparency_history");
  const state = previous === null ? await stateFromInitialQuery(query) : await advanceState(previous, query.entriesSinceLastHead, query.head);
  return { record: query.record, state };
};

// packages/service-protocol/src/index.ts
var RELAY_PROTOCOL = "agents-city-relay/4";
var DEVICE_PROOF_PROTOCOL = "agents-city-device-proof/1";
var DEVICE_RATCHET_BUNDLE_PROTOCOL = "agents-city-device-ratchet/1";
var ROAD_TEXT_PROTOCOL = "agents-city-road-text/2";
var MAX_FRAME_BYTES = 32768;
var MAX_SERVER_FRAME_BYTES = 262144;
var MAX_BATCH_MESSAGES = 32;
var MAX_DIRECTORY_PAGE_ROADS = 100;
var MAX_CIPHERTEXT_BYTES = 16384;
var MAX_CLOCK_SKEW_MS = 9e4;
var MAX_MESSAGE_LIFETIME_MS = 60 * 60 * 1e3;
var CITY_PART = "[a-z0-9][a-z0-9_-]{0,31}";
var CITY_ADDRESS_RE = new RegExp(`^${CITY_PART}/${CITY_PART}$`);
var PLAN_ENTITLEMENTS = Object.freeze({
  free: Object.freeze({
    code: "free",
    ownedSpaces: 1,
    internalMembers: 3,
    externalGuests: 3,
    connectedCitiesPerAccount: 3,
    activeRoads: 5,
    activeConnections: 3,
    invitationsPerDay: 5,
    messagesPerMinutePerCity: 12,
    bytesPerMinutePerCity: 96 * 1024
  }),
  company: Object.freeze({
    code: "company",
    ownedSpaces: 3,
    internalMembers: 10,
    externalGuests: 25,
    connectedCitiesPerAccount: 10,
    activeRoads: 100,
    activeConnections: 25,
    invitationsPerDay: 100,
    messagesPerMinutePerCity: 60,
    bytesPerMinutePerCity: 512 * 1024
  }),
  custom: Object.freeze({
    code: "custom",
    ownedSpaces: 100,
    internalMembers: 1e4,
    externalGuests: 1e4,
    connectedCitiesPerAccount: 100,
    activeRoads: 1e5,
    activeConnections: 1e4,
    invitationsPerDay: 1e4,
    messagesPerMinutePerCity: 240,
    bytesPerMinutePerCity: 2 * 1024 * 1024
  })
});
var isCityAddress = (value) => typeof value === "string" && CITY_ADDRESS_RE.test(value);
var utf8Bytes = (value) => new TextEncoder().encode(value);
var byteLength = (value) => utf8Bytes(value).byteLength;
var canonicalDeviceProof = (fields) => [
  DEVICE_PROOF_PROTOCOL,
  fields.method.toUpperCase(),
  fields.pathname,
  fields.deviceId,
  fields.city,
  String(fields.timestamp),
  fields.nonce,
  fields.bodySha256.toLowerCase()
].join("\n");
var canonicalDeviceRatchetBundle = (bundle) => [
  bundle.protocol,
  bundle.identityKey,
  bundle.signingKey,
  ...[...bundle.oneTimeKeys].sort((left, right) => left.id.localeCompare(right.id)).map((prekey) => `${prekey.id}:${prekey.key}`)
].join("\n");
var canonicalRelayEnvelope = (envelope) => {
  const common = [
    envelope.protocol,
    envelope.id,
    envelope.requestId,
    envelope.roadId,
    String(envelope.roadRevision),
    envelope.from,
    envelope.to,
    String(envelope.createdAt),
    String(envelope.expiresAt),
    envelope.senderDeviceId,
    String(envelope.senderKeyVersion),
    envelope.payload.suite,
    envelope.payload.recipientKeyId,
    String(envelope.payload.messageType)
  ];
  if (envelope.payload.suite === HYBRID_ESTABLISHMENT_SUITE) {
    common.push(
      envelope.payload.pqPrekeyId,
      envelope.payload.pqPrekeyHash,
      envelope.payload.ephemeralKey,
      envelope.payload.nonce
    );
  }
  common.push(envelope.payload.ciphertext);
  return common.join("\n");
};
var hasOnlyKeys = (value, allowed) => {
  const expected = new Set(allowed);
  return Object.keys(value).every((key) => expected.has(key)) && allowed.every((key) => key in value);
};
var parseRelayClientFrame = (raw, now = Date.now()) => {
  if (byteLength(raw) > MAX_FRAME_BYTES) return { ok: false, code: "frame_too_large" };
  let candidate;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return { ok: false, code: "invalid_json" };
  }
  if (!candidate || typeof candidate !== "object") return { ok: false, code: "invalid_frame" };
  const value = candidate;
  if (value.type === "ping") {
    if (!Object.keys(value).every((key) => ["type", "at"].includes(key)) || "at" in value && (typeof value.at !== "number" || !Number.isSafeInteger(value.at) || value.at < 0)) return { ok: false, code: "invalid_frame" };
    return { ok: true, frame: { type: "ping", at: value.at } };
  }
  if (value.type === "ack") {
    if (!hasOnlyKeys(value, ["type", "messageId"])) return { ok: false, code: "invalid_ack" };
    if (typeof value.messageId !== "string" || !UUID_RE.test(value.messageId)) {
      return { ok: false, code: "invalid_ack" };
    }
    return { ok: true, frame: { type: "ack", messageId: value.messageId } };
  }
  if (value.type === "ack_batch") {
    if (!hasOnlyKeys(value, ["type", "messageIds"]) || !Array.isArray(value.messageIds) || value.messageIds.length < 1 || value.messageIds.length > MAX_BATCH_MESSAGES || !value.messageIds.every((messageId) => typeof messageId === "string" && UUID_RE.test(messageId)) || new Set(value.messageIds).size !== value.messageIds.length) return { ok: false, code: "invalid_ack_batch" };
    return { ok: true, frame: { type: "ack_batch", messageIds: value.messageIds } };
  }
  if (value.type === "directory_next") {
    if (!hasOnlyKeys(value, ["type", "snapshotId", "page"]) || typeof value.snapshotId !== "string" || !UUID_RE.test(value.snapshotId) || !Number.isSafeInteger(value.page) || Number(value.page) < 2 || Number(value.page) > 5e3) return { ok: false, code: "invalid_directory_next" };
    return {
      ok: true,
      frame: {
        type: "directory_next",
        snapshotId: value.snapshotId,
        page: Number(value.page)
      }
    };
  }
  if (value.type === "capability_register") {
    if (!hasOnlyKeys(value, ["type", "requestId", "capabilities"]) || typeof value.requestId !== "string" || !UUID_RE.test(value.requestId) || !Array.isArray(value.capabilities) || value.capabilities.length < 1 || value.capabilities.length > MAX_SEALED_CAPABILITIES_PER_BATCH) return { ok: false, code: "invalid_capability_registration" };
    const capabilities = value.capabilities.map((capability) => parseSealedCapabilityRegistration(capability, now));
    if (capabilities.some((capability) => capability === null) || new Set(capabilities.map((capability) => capability?.tokenHash)).size !== capabilities.length || new Set(capabilities.map((capability) => capability?.receiptTag)).size !== capabilities.length) return { ok: false, code: "invalid_capability_registration" };
    return {
      ok: true,
      frame: {
        type: "capability_register",
        requestId: value.requestId,
        capabilities
      }
    };
  }
  if (value.type === "capability_revoke") {
    if (!hasOnlyKeys(value, ["type", "requestId", "channelTag"]) || typeof value.requestId !== "string" || !UUID_RE.test(value.requestId) || typeof value.channelTag !== "string" || base64urlDecodedLength(value.channelTag) !== 24) return { ok: false, code: "invalid_capability_revocation" };
    return {
      ok: true,
      frame: {
        type: "capability_revoke",
        requestId: value.requestId,
        channelTag: value.channelTag
      }
    };
  }
  if (value.type !== "send" || !value.envelope || typeof value.envelope !== "object") {
    return { ok: false, code: "invalid_frame" };
  }
  if (!hasOnlyKeys(value, ["type", "envelope"])) return { ok: false, code: "invalid_frame" };
  const envelope = value.envelope;
  const envelopeRecord = value.envelope;
  const payloadRecord = envelope.payload;
  const classicalPayload = payloadRecord?.suite === SEALED_SUITE;
  const hybridPayload = payloadRecord?.suite === HYBRID_ESTABLISHMENT_SUITE;
  const payloadKeys = hybridPayload ? [
    "suite",
    "recipientKeyId",
    "messageType",
    "ciphertext",
    "pqPrekeyId",
    "pqPrekeyHash",
    "ephemeralKey",
    "nonce"
  ] : ["suite", "recipientKeyId", "messageType", "ciphertext"];
  if (!hasOnlyKeys(envelopeRecord, [
    "protocol",
    "id",
    "requestId",
    "roadId",
    "roadRevision",
    "from",
    "to",
    "createdAt",
    "expiresAt",
    "senderDeviceId",
    "senderKeyVersion",
    "payload",
    "signature"
  ]) || !payloadRecord || !classicalPayload && !hybridPayload || !hasOnlyKeys(payloadRecord, payloadKeys) || envelope.protocol !== RELAY_PROTOCOL || !UUID_RE.test(String(envelope.id ?? "")) || !UUID_RE.test(String(envelope.requestId ?? "")) || !UUID_RE.test(String(envelope.roadId ?? "")) || !Number.isSafeInteger(envelope.roadRevision) || envelope.roadRevision < 1 || !isCityAddress(envelope.from) || !isCityAddress(envelope.to) || envelope.from === envelope.to || !Number.isSafeInteger(envelope.createdAt) || !Number.isSafeInteger(envelope.expiresAt) || envelope.createdAt > now + MAX_CLOCK_SKEW_MS || envelope.createdAt < now - MAX_CLOCK_SKEW_MS || envelope.expiresAt <= now || envelope.expiresAt - envelope.createdAt > MAX_MESSAGE_LIFETIME_MS || !UUID_RE.test(String(envelope.senderDeviceId ?? "")) || !Number.isSafeInteger(envelope.senderKeyVersion) || envelope.senderKeyVersion < 1 || !envelope.payload || typeof envelope.payload.recipientKeyId !== "string" || base64urlDecodedLength(envelope.payload.recipientKeyId) !== 32 || classicalPayload && ![0, 1].includes(envelope.payload.messageType) || hybridPayload && envelope.payload.messageType !== 0 || typeof envelope.payload.ciphertext !== "string" || classicalPayload && (standardBase64DecodedLength(envelope.payload.ciphertext) > MAX_CIPHERTEXT_BYTES || standardBase64DecodedLength(envelope.payload.ciphertext) < 17) || hybridPayload && (base64urlDecodedLength(envelope.payload.ciphertext) > MAX_CIPHERTEXT_BYTES + 2048 || base64urlDecodedLength(envelope.payload.ciphertext) < 1105 || typeof envelope.payload.pqPrekeyId !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(
    envelope.payload.pqPrekeyId
  ) || base64urlDecodedLength(
    envelope.payload.pqPrekeyHash
  ) !== 32 || base64urlDecodedLength(
    envelope.payload.ephemeralKey
  ) !== 32 || base64urlDecodedLength(
    envelope.payload.nonce
  ) !== 12) || typeof envelope.signature !== "string" || base64urlDecodedLength(envelope.signature) !== 64) {
    return { ok: false, code: "invalid_envelope" };
  }
  return { ok: true, frame: { type: "send", envelope } };
};
var publicOkp = (value, curve) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const jwk = value;
  return hasOnlyKeys(jwk, ["kty", "crv", "x", "ext"]) && jwk.kty === "OKP" && jwk.crv === curve && jwk.ext === true && typeof jwk.x === "string" && base64urlDecodedLength(jwk.x) === 32;
};
var isRoadDirectoryEntry = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const road = value;
  return hasOnlyKeys(road, [
    "id",
    "revision",
    "localCity",
    "peerCity",
    "localEncryptionKeyId",
    "peerEncryptionKeyId",
    "peerSigningPublicJwk",
    "peerEncryptionPublicJwk",
    "ratchetRole",
    "peerDeviceId",
    "peerRatchetIdentityKey",
    "peerRatchetSigningKey",
    "peerOneTimeKeyId",
    "peerOneTimeKey",
    "establishmentSuite",
    "peerHybridPrekey",
    "localHybridPrekeyId"
  ]) && typeof road.id === "string" && UUID_RE.test(road.id) && Number.isSafeInteger(road.revision) && Number(road.revision) >= 1 && isCityAddress(road.localCity) && isCityAddress(road.peerCity) && road.localCity !== road.peerCity && typeof road.localEncryptionKeyId === "string" && base64urlDecodedLength(road.localEncryptionKeyId) === 32 && typeof road.peerEncryptionKeyId === "string" && base64urlDecodedLength(road.peerEncryptionKeyId) === 32 && publicOkp(road.peerSigningPublicJwk, "Ed25519") && publicOkp(road.peerEncryptionPublicJwk, "X25519") && ["initiator", "responder"].includes(String(road.ratchetRole)) && typeof road.peerDeviceId === "string" && UUID_RE.test(road.peerDeviceId) && typeof road.peerRatchetIdentityKey === "string" && standardBase64DecodedLength(road.peerRatchetIdentityKey) === 32 && typeof road.peerRatchetSigningKey === "string" && standardBase64DecodedLength(road.peerRatchetSigningKey) === 32 && (road.establishmentSuite === SEALED_SUITE || road.establishmentSuite === HYBRID_ESTABLISHMENT_SUITE) && (road.ratchetRole === "initiator" && typeof road.peerOneTimeKeyId === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(road.peerOneTimeKeyId) && typeof road.peerOneTimeKey === "string" && standardBase64DecodedLength(road.peerOneTimeKey) === 32 || road.ratchetRole === "responder" && road.peerOneTimeKeyId === null && road.peerOneTimeKey === null) && (road.establishmentSuite === HYBRID_ESTABLISHMENT_SUITE && road.ratchetRole === "initiator" && road.localHybridPrekeyId === null && parseSignedHybridPrekey(road.peerHybridPrekey) !== null || road.establishmentSuite === HYBRID_ESTABLISHMENT_SUITE && road.ratchetRole === "responder" && typeof road.localHybridPrekeyId === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(road.localHybridPrekeyId) && road.peerHybridPrekey === null || road.establishmentSuite === SEALED_SUITE && road.localHybridPrekeyId === null && road.peerHybridPrekey === null);
};
var parseServerMessage = (value, now) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const message = value;
  if (!hasOnlyKeys(message, ["envelope", "delayedMs"]) || !Number.isSafeInteger(message.delayedMs) || Number(message.delayedMs) < 0) return null;
  const envelope = message.envelope;
  if (!envelope || typeof envelope !== "object" || !Number.isSafeInteger(envelope.createdAt) || Number(envelope.createdAt) > now + MAX_CLOCK_SKEW_MS) return null;
  const parsed = parseRelayClientFrame(
    JSON.stringify({ type: "send", envelope: message.envelope }),
    Number(envelope.createdAt)
  );
  if (!parsed.ok || parsed.frame.type !== "send" || parsed.frame.envelope.expiresAt <= now) return null;
  return { envelope: parsed.frame.envelope, delayedMs: Number(message.delayedMs) };
};
var parseServerSealedMessage = (value, now) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const message = value;
  if (!hasOnlyKeys(message, ["delivery", "delayedMs"]) || !Number.isSafeInteger(message.delayedMs) || Number(message.delayedMs) < 0) return null;
  const delivery = parseSealedDelivery(message.delivery, now);
  return delivery ? { delivery, delayedMs: Number(message.delayedMs) } : null;
};
var parseRelayServerFrame = (raw, now = Date.now()) => {
  if (byteLength(raw) > MAX_SERVER_FRAME_BYTES) return { ok: false, code: "frame_too_large" };
  let candidate;
  try {
    candidate = JSON.parse(raw);
  } catch {
    return { ok: false, code: "invalid_json" };
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return { ok: false, code: "invalid_frame" };
  }
  const value = candidate;
  if (value.type === "welcome") {
    if (!hasOnlyKeys(value, ["type", "city", "deviceId", "protocol", "roadCount"]) || !isCityAddress(value.city) || typeof value.deviceId !== "string" || !UUID_RE.test(value.deviceId) || value.protocol !== RELAY_PROTOCOL || !Number.isSafeInteger(value.roadCount) || Number(value.roadCount) < 0 || Number(value.roadCount) > 1e5) return { ok: false, code: "invalid_welcome" };
    return { ok: true, frame: value };
  }
  if (value.type === "road_directory") {
    if (!hasOnlyKeys(value, ["type", "snapshotId", "page", "pages", "roads"]) || typeof value.snapshotId !== "string" || !UUID_RE.test(value.snapshotId) || !Number.isSafeInteger(value.page) || !Number.isSafeInteger(value.pages) || Number(value.page) < 1 || Number(value.pages) < 1 || Number(value.page) > Number(value.pages) || Number(value.pages) > 5e3 || !Array.isArray(value.roads) || value.roads.length > MAX_DIRECTORY_PAGE_ROADS || !value.roads.every(isRoadDirectoryEntry) || new Set(value.roads.map((road) => road.id)).size !== value.roads.length) return { ok: false, code: "invalid_road_directory" };
    return { ok: true, frame: value };
  }
  if (value.type === "road_update") {
    const allowed = value.road === void 0 ? ["type", "roadId", "revision", "status"] : ["type", "roadId", "revision", "status", "road"];
    if (!hasOnlyKeys(value, allowed) || typeof value.roadId !== "string" || !UUID_RE.test(value.roadId) || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1 || !["active", "revoked"].includes(String(value.status)) || value.status === "active" && (!isRoadDirectoryEntry(value.road) || value.road.id !== value.roadId || value.road.revision !== value.revision) || value.status === "revoked" && value.road !== void 0) return { ok: false, code: "invalid_road_update" };
    return { ok: true, frame: value };
  }
  if (value.type === "message") {
    if (!hasOnlyKeys(value, ["type", "envelope", "delayedMs"])) return { ok: false, code: "invalid_message" };
    const parsed = parseServerMessage({ envelope: value.envelope, delayedMs: value.delayedMs }, now);
    if (!parsed) return { ok: false, code: "invalid_message" };
    return { ok: true, frame: { type: "message", ...parsed } };
  }
  if (value.type === "message_batch") {
    if (!hasOnlyKeys(value, ["type", "messages"]) || !Array.isArray(value.messages) || value.messages.length < 1 || value.messages.length > MAX_BATCH_MESSAGES) return { ok: false, code: "invalid_message_batch" };
    const messages = value.messages.map((message) => parseServerMessage(message, now));
    if (messages.some((message) => message === null) || new Set(messages.map((message) => message?.envelope.id)).size !== messages.length) return { ok: false, code: "invalid_message_batch" };
    return {
      ok: true,
      frame: {
        type: "message_batch",
        messages
      }
    };
  }
  if (value.type === "sealed_message") {
    if (!hasOnlyKeys(value, ["type", "delivery", "delayedMs"])) {
      return { ok: false, code: "invalid_sealed_message" };
    }
    const parsed = parseServerSealedMessage({
      delivery: value.delivery,
      delayedMs: value.delayedMs
    }, now);
    if (!parsed) return { ok: false, code: "invalid_sealed_message" };
    return { ok: true, frame: { type: "sealed_message", ...parsed } };
  }
  if (value.type === "sealed_message_batch") {
    if (!hasOnlyKeys(value, ["type", "messages"]) || !Array.isArray(value.messages) || value.messages.length < 1 || value.messages.length > MAX_BATCH_MESSAGES) return { ok: false, code: "invalid_sealed_message_batch" };
    const messages = value.messages.map((message) => parseServerSealedMessage(message, now));
    if (messages.some((message) => message === null) || new Set(messages.map((message) => message?.delivery.id)).size !== messages.length) return { ok: false, code: "invalid_sealed_message_batch" };
    return {
      ok: true,
      frame: {
        type: "sealed_message_batch",
        messages
      }
    };
  }
  if (value.type === "result") {
    if (!hasOnlyKeys(value, ["type", "requestId", "messageId", "status"]) || typeof value.requestId !== "string" || !UUID_RE.test(value.requestId) || typeof value.messageId !== "string" || !UUID_RE.test(value.messageId) || !["queued", "duplicate"].includes(String(value.status))) return { ok: false, code: "invalid_result" };
    return { ok: true, frame: value };
  }
  if (value.type === "capability_result") {
    if (!hasOnlyKeys(value, ["type", "requestId", "status", "affected"]) || typeof value.requestId !== "string" || !UUID_RE.test(value.requestId) || !["registered", "revoked"].includes(String(value.status)) || !Number.isSafeInteger(value.affected) || Number(value.affected) < 0 || Number(value.affected) > 4096) return { ok: false, code: "invalid_capability_result" };
    return { ok: true, frame: value };
  }
  if (value.type === "error") {
    const allowed = [
      "type",
      "code",
      ...value.requestId === void 0 ? [] : ["requestId"],
      ...value.retryAfterMs === void 0 ? [] : ["retryAfterMs"]
    ];
    if (!hasOnlyKeys(value, allowed) || typeof value.code !== "string" || !/^[a-z0-9_]{1,80}$/.test(value.code) || value.requestId !== void 0 && (typeof value.requestId !== "string" || !UUID_RE.test(value.requestId)) || value.retryAfterMs !== void 0 && (!Number.isSafeInteger(value.retryAfterMs) || Number(value.retryAfterMs) < 0 || Number(value.retryAfterMs) > 36e5)) return { ok: false, code: "invalid_error" };
    return { ok: true, frame: value };
  }
  if (value.type === "pong") {
    if (!hasOnlyKeys(value, ["type", "at"]) || !Number.isSafeInteger(value.at)) {
      return { ok: false, code: "invalid_pong" };
    }
    return { ok: true, frame: value };
  }
  return { ok: false, code: "invalid_frame" };
};

// packages/connect-client/src/encoding.ts
var BASE64URL_RE2 = /^[A-Za-z0-9_-]+$/;
var textEncoder = new TextEncoder();
var textDecoder = new TextDecoder("utf-8", { fatal: true });
var toArrayBuffer = (value) => {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
};
var concatBytes2 = (...values) => {
  const result = new Uint8Array(values.reduce((total, value) => total + value.byteLength, 0));
  let offset = 0;
  for (const value of values) {
    result.set(value, offset);
    offset += value.byteLength;
  }
  return result;
};
var bytesToBase64url2 = (value) => {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
};
var base64urlToBytes2 = (value) => {
  if (!value || !BASE64URL_RE2.test(value)) throw new Error("invalid_base64url");
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
};
var bytesToHex = (value) => [...value].map((byte) => byte.toString(16).padStart(2, "0")).join("");
var randomBase64url = (bytes = 24) => {
  const value = new Uint8Array(bytes);
  crypto.getRandomValues(value);
  return bytesToBase64url2(value);
};
var sha256Bytes = async (value) => new Uint8Array(
  await crypto.subtle.digest(
    "SHA-256",
    toArrayBuffer(typeof value === "string" ? textEncoder.encode(value) : value)
  )
);
var sha256Hex = async (value) => bytesToHex(await sha256Bytes(value));
var sha256Base64url2 = async (value) => bytesToBase64url2(await sha256Bytes(value));
var utf8Length = (value) => textEncoder.encode(value).byteLength;

// packages/connect-client/src/ratchet.ts
var Vodozemac = __toESM(require_kinsh_vodozemac_wasm(), 1);

// packages/hybrid-crypto/pkg/agents_city_hybrid_crypto.js
var wasm;
var cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
  if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
    cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
  }
  return cachedUint8ArrayMemory0;
}
var cachedTextDecoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
var MAX_SAFARI_DECODE_BYTES = 2146435072;
var numBytesDecoded = 0;
function decodeText(ptr, len) {
  numBytesDecoded += len;
  if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
    cachedTextDecoder = new TextDecoder("utf-8", { ignoreBOM: true, fatal: true });
    cachedTextDecoder.decode();
    numBytesDecoded = len;
  }
  return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}
function getStringFromWasm0(ptr, len) {
  ptr = ptr >>> 0;
  return decodeText(ptr, len);
}
var heap = new Array(128).fill(void 0);
heap.push(void 0, null, true, false);
var heap_next = heap.length;
function addHeapObject(obj) {
  if (heap_next === heap.length) heap.push(heap.length + 1);
  const idx = heap_next;
  heap_next = heap[idx];
  heap[idx] = obj;
  return idx;
}
var WASM_VECTOR_LEN = 0;
function passArray8ToWasm0(arg, malloc) {
  const ptr = malloc(arg.length * 1, 1) >>> 0;
  getUint8ArrayMemory0().set(arg, ptr / 1);
  WASM_VECTOR_LEN = arg.length;
  return ptr;
}
var cachedDataViewMemory0 = null;
function getDataViewMemory0() {
  if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || cachedDataViewMemory0.buffer.detached === void 0 && cachedDataViewMemory0.buffer !== wasm.memory.buffer) {
    cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
  }
  return cachedDataViewMemory0;
}
function getObject(idx) {
  return heap[idx];
}
function dropObject(idx) {
  if (idx < 132) return;
  heap[idx] = heap_next;
  heap_next = idx;
}
function takeObject(idx) {
  const ret = getObject(idx);
  dropObject(idx);
  return ret;
}
function getArrayU8FromWasm0(ptr, len) {
  ptr = ptr >>> 0;
  return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}
function mlkem768_public_key(seed) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passArray8ToWasm0(seed, wasm.__wbindgen_export_0);
    const len0 = WASM_VECTOR_LEN;
    wasm.mlkem768_public_key(retptr, ptr0, len0);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
    if (r3) {
      throw takeObject(r2);
    }
    var v2 = getArrayU8FromWasm0(r0, r1).slice();
    wasm.__wbindgen_export_1(r0, r1 * 1, 1);
    return v2;
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}
function hybrid_seal(public_key, classical_secret, transcript, plaintext, kem_randomness, nonce) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passArray8ToWasm0(public_key, wasm.__wbindgen_export_0);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(classical_secret, wasm.__wbindgen_export_0);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(transcript, wasm.__wbindgen_export_0);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArray8ToWasm0(plaintext, wasm.__wbindgen_export_0);
    const len3 = WASM_VECTOR_LEN;
    const ptr4 = passArray8ToWasm0(kem_randomness, wasm.__wbindgen_export_0);
    const len4 = WASM_VECTOR_LEN;
    const ptr5 = passArray8ToWasm0(nonce, wasm.__wbindgen_export_0);
    const len5 = WASM_VECTOR_LEN;
    wasm.hybrid_seal(retptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4, ptr5, len5);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
    if (r3) {
      throw takeObject(r2);
    }
    var v7 = getArrayU8FromWasm0(r0, r1).slice();
    wasm.__wbindgen_export_1(r0, r1 * 1, 1);
    return v7;
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}
function hybrid_open(seed, classical_secret, transcript, ciphertext, nonce) {
  try {
    const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
    const ptr0 = passArray8ToWasm0(seed, wasm.__wbindgen_export_0);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray8ToWasm0(classical_secret, wasm.__wbindgen_export_0);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(transcript, wasm.__wbindgen_export_0);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArray8ToWasm0(ciphertext, wasm.__wbindgen_export_0);
    const len3 = WASM_VECTOR_LEN;
    const ptr4 = passArray8ToWasm0(nonce, wasm.__wbindgen_export_0);
    const len4 = WASM_VECTOR_LEN;
    wasm.hybrid_open(retptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4);
    var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
    var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
    var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
    var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
    if (r3) {
      throw takeObject(r2);
    }
    var v6 = getArrayU8FromWasm0(r0, r1).slice();
    wasm.__wbindgen_export_1(r0, r1 * 1, 1);
    return v6;
  } finally {
    wasm.__wbindgen_add_to_stack_pointer(16);
  }
}
var EXPECTED_RESPONSE_TYPES = /* @__PURE__ */ new Set(["basic", "cors", "default"]);
async function __wbg_load(module, imports) {
  if (typeof Response === "function" && module instanceof Response) {
    if (typeof WebAssembly.instantiateStreaming === "function") {
      try {
        return await WebAssembly.instantiateStreaming(module, imports);
      } catch (e) {
        const validResponse = module.ok && EXPECTED_RESPONSE_TYPES.has(module.type);
        if (validResponse && module.headers.get("Content-Type") !== "application/wasm") {
          console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);
        } else {
          throw e;
        }
      }
    }
    const bytes = await module.arrayBuffer();
    return await WebAssembly.instantiate(bytes, imports);
  } else {
    const instance = await WebAssembly.instantiate(module, imports);
    if (instance instanceof WebAssembly.Instance) {
      return { instance, module };
    } else {
      return instance;
    }
  }
}
function __wbg_get_imports() {
  const imports = {};
  imports.wbg = {};
  imports.wbg.__wbg_Error_e17e777aac105295 = function(arg0, arg1) {
    const ret = Error(getStringFromWasm0(arg0, arg1));
    return addHeapObject(ret);
  };
  return imports;
}
function __wbg_init_memory(imports, memory) {
}
function __wbg_finalize_init(instance, module) {
  wasm = instance.exports;
  __wbg_init.__wbindgen_wasm_module = module;
  cachedDataViewMemory0 = null;
  cachedUint8ArrayMemory0 = null;
  return wasm;
}
async function __wbg_init(module_or_path) {
  if (wasm !== void 0) return wasm;
  if (typeof module_or_path !== "undefined") {
    if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
      ({ module_or_path } = module_or_path);
    } else {
      console.warn("using deprecated parameters for the initialization function; pass a single object instead");
    }
  }
  if (typeof module_or_path === "undefined") {
    module_or_path = new URL("agents_city_hybrid_crypto_bg.wasm", import.meta.url);
  }
  const imports = __wbg_get_imports();
  if (typeof module_or_path === "string" || typeof Request === "function" && module_or_path instanceof Request || typeof URL === "function" && module_or_path instanceof URL) {
    module_or_path = fetch(module_or_path);
  }
  __wbg_init_memory(imports);
  const { instance, module } = await __wbg_load(await module_or_path, imports);
  return __wbg_finalize_init(instance, module);
}
var agents_city_hybrid_crypto_default = __wbg_init;

// packages/connect-client/src/hybrid-crypto.ts
var WASM_URL = new URL(
  "../../hybrid-crypto/pkg/agents_city_hybrid_crypto_bg.wasm",
  import.meta.url
);
var PORTABLE_WASM_URL = new URL("./agents_city_hybrid_crypto_bg.wasm", import.meta.url);
var hybridInitialization = null;
var defaultWasmInput = async () => {
  if (typeof process !== "undefined" && process.versions?.node) {
    const { readFile: readFile2 } = await import("node:fs/promises");
    try {
      return new Uint8Array(await readFile2(WASM_URL));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return new Uint8Array(await readFile2(PORTABLE_WASM_URL));
    }
  }
  return WASM_URL;
};
var initializeHybridCrypto = (input) => {
  if (!hybridInitialization) {
    hybridInitialization = Promise.resolve(input ?? defaultWasmInput()).then((moduleInput) => agents_city_hybrid_crypto_default({ module_or_path: moduleInput })).then(() => void 0).catch((error) => {
      hybridInitialization = null;
      throw new Error("hybrid_crypto_initialization_failed", { cause: error });
    });
  }
  return hybridInitialization;
};
var requireBytes = (value, length, code) => {
  if (!(value instanceof Uint8Array) || value.byteLength !== length) throw new Error(code);
};
var requirePrivateX25519 = (value) => {
  if (value.kty !== "OKP" || value.crv !== "X25519" || typeof value.x !== "string" || typeof value.d !== "string" || base64urlToBytes2(value.x).byteLength !== 32 || base64urlToBytes2(value.d).byteLength !== 32) throw new Error("invalid_x25519_private_key");
  return value;
};
var requirePublicX25519 = (value) => {
  if (value.kty !== "OKP" || value.crv !== "X25519" || typeof value.x !== "string" || value.d !== void 0 || base64urlToBytes2(value.x).byteLength !== 32) throw new Error("invalid_x25519_public_key");
  return { kty: "OKP", crv: "X25519", x: value.x, ext: true };
};
var deriveX25519 = async (privateKey, publicJwk) => {
  const publicKey = await crypto.subtle.importKey(
    "jwk",
    requirePublicX25519(publicJwk),
    { name: "X25519" },
    false,
    []
  );
  const shared = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "X25519", public: publicKey },
    privateKey,
    256
  ));
  requireBytes(shared, 32, "invalid_x25519_shared_secret");
  if (shared.every((byte) => byte === 0)) {
    shared.fill(0);
    throw new Error("invalid_x25519_shared_secret");
  }
  return shared;
};
var createHybridSenderSecret = async (recipientPublicJwk) => {
  const ephemeral = await crypto.subtle.generateKey(
    { name: "X25519" },
    true,
    ["deriveBits"]
  );
  const publicJwk = requirePublicX25519(await crypto.subtle.exportKey("jwk", ephemeral.publicKey));
  return {
    ephemeralKey: publicJwk.x,
    classicalSecret: await deriveX25519(ephemeral.privateKey, recipientPublicJwk)
  };
};
var deriveHybridRecipientSecret = async (recipientPrivateJwk, ephemeralKey) => {
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    requirePrivateX25519(recipientPrivateJwk),
    { name: "X25519" },
    false,
    ["deriveBits"]
  );
  return deriveX25519(privateKey, {
    kty: "OKP",
    crv: "X25519",
    x: ephemeralKey,
    ext: true
  });
};
var generateMlKem768Prekey = async () => {
  await initializeHybridCrypto();
  const seed = crypto.getRandomValues(new Uint8Array(MLKEM768_SEED_BYTES));
  try {
    const publicKey = mlkem768_public_key(seed);
    requireBytes(publicKey, MLKEM768_PUBLIC_KEY_BYTES, "invalid_mlkem768_public_key");
    return {
      seed: bytesToBase64url2(seed),
      publicKey: bytesToBase64url2(publicKey)
    };
  } finally {
    seed.fill(0);
  }
};
var hybridPrekeyHash = (publicKey) => {
  const bytes = base64urlToBytes2(publicKey);
  requireBytes(bytes, MLKEM768_PUBLIC_KEY_BYTES, "invalid_mlkem768_public_key");
  return sha256Base64url2(bytes).finally(() => bytes.fill(0));
};
var sealHybridEstablishment = (publicKey, classicalSecret, transcript, plaintext, kemRandomness, nonce) => {
  requireBytes(classicalSecret, 32, "invalid_x25519_shared_secret");
  requireBytes(kemRandomness, 32, "invalid_mlkem768_encapsulation_randomness");
  requireBytes(nonce, HYBRID_NONCE_BYTES, "invalid_hybrid_nonce");
  const publicBytes = base64urlToBytes2(publicKey);
  requireBytes(publicBytes, MLKEM768_PUBLIC_KEY_BYTES, "invalid_mlkem768_public_key");
  const transcriptBytes = textEncoder.encode(transcript);
  const plaintextBytes = textEncoder.encode(plaintext);
  try {
    return bytesToBase64url2(hybrid_seal(
      publicBytes,
      classicalSecret,
      transcriptBytes,
      plaintextBytes,
      kemRandomness,
      nonce
    ));
  } finally {
    publicBytes.fill(0);
    transcriptBytes.fill(0);
    plaintextBytes.fill(0);
  }
};
var openHybridEstablishment = (seed, classicalSecret, transcript, ciphertext, nonce) => {
  requireBytes(classicalSecret, 32, "invalid_x25519_shared_secret");
  requireBytes(nonce, HYBRID_NONCE_BYTES, "invalid_hybrid_nonce");
  const seedBytes = base64urlToBytes2(seed);
  const transcriptBytes = textEncoder.encode(transcript);
  const ciphertextBytes = base64urlToBytes2(ciphertext);
  requireBytes(seedBytes, MLKEM768_SEED_BYTES, "invalid_mlkem768_seed");
  try {
    return textDecoder.decode(hybrid_open(
      seedBytes,
      classicalSecret,
      transcriptBytes,
      ciphertextBytes,
      nonce
    ));
  } finally {
    seedBytes.fill(0);
    transcriptBytes.fill(0);
    ciphertextBytes.fill(0);
  }
};
var randomHybridNonce = () => crypto.getRandomValues(
  new Uint8Array(HYBRID_NONCE_BYTES)
);
var randomKemEncapsulation = () => crypto.getRandomValues(new Uint8Array(32));
var wipeHybridSecret = (value) => value.fill(0);

// packages/connect-client/src/ratchet.ts
var ROAD_RATCHET_PROTOCOL = "agents-city-road-ratchet/1";
var ROAD_RATCHET_SUITE = "OLM-V1-CURVE25519-AES256-HMAC-SHA256";
var DEFAULT_ONE_TIME_KEYS = 32;
var DEFAULT_HYBRID_ONE_TIME_KEYS = 16;
var MAX_HYBRID_ONE_TIME_KEYS = 64;
var MAX_SEEN_MESSAGE_IDS = 512;
var MAX_PENDING_PLAINTEXTS = 64;
var MAX_RATCHET_PLAINTEXT_BYTES = 16384;
var MAX_PENDING_PLAINTEXT_AGE_MS = 60 * 60 * 1e3;
var { Account, Session } = Vodozemac;
var wasmInitialization = null;
var ensureRatchetWasm = () => {
  if (wasmInitialization) return wasmInitialization;
  const initializer = Vodozemac.default;
  wasmInitialization = typeof initializer === "function" ? Promise.resolve(initializer()).then(() => void 0) : Promise.resolve();
  return wasmInitialization;
};
var LEGACY_STATE_PROTOCOL = "agents-city-ratchet-state/3";
var TRANSPARENCY_STATE_PROTOCOL = "agents-city-ratchet-state/4";
var SEALED_STATE_PROTOCOL = "agents-city-ratchet-state/5";
var HYBRID_STATE_PROTOCOL = "agents-city-ratchet-state/6";
var ESTABLISHMENT_STATE_PROTOCOL = "agents-city-ratchet-state/7";
var STATE_PROTOCOL = "agents-city-ratchet-state/8";
var STATE_RECORD = "device-ratchet-state";
var BASE64_RE = /^[A-Za-z0-9+/]+={0,2}$/;
var UUID_RE2 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var CITY_ADDRESS_RE2 = /^[a-z0-9][a-z0-9_-]{0,31}\/[a-z0-9][a-z0-9_-]{0,31}$/;
var isBase64Key = (value) => {
  if (typeof value !== "string" || !BASE64_RE.test(value)) return false;
  try {
    if (value.length % 4 === 1) return false;
    const raw = atob(value.padEnd(Math.ceil(value.length / 4) * 4, "="));
    return raw.length === 32;
  } catch {
    return false;
  }
};
var isBase64urlBytes = (value, bytes) => typeof value === "string" && base64urlDecodedLength(value) === bytes;
var parseIdentityKeys = (raw) => {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("invalid_ratchet_identity");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_ratchet_identity");
  }
  const record = value;
  if (Object.keys(record).length !== 2 || !isBase64Key(record.curve25519) || !isBase64Key(record.ed25519)) throw new Error("invalid_ratchet_identity");
  return {
    identityKey: String(record.curve25519),
    signingKey: String(record.ed25519)
  };
};
var parseOneTimeKeys = (raw) => {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error("invalid_ratchet_prekeys");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_ratchet_prekeys");
  }
  const outer = value;
  const curve = outer.curve25519;
  if (Object.keys(outer).length !== 1 || !curve || typeof curve !== "object" || Array.isArray(curve)) throw new Error("invalid_ratchet_prekeys");
  const entries = Object.entries(curve);
  if (entries.length > 50) throw new Error("invalid_ratchet_prekeys");
  return entries.map(([id, key]) => {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || !isBase64Key(key)) {
      throw new Error("invalid_ratchet_prekeys");
    }
    return { id, key: String(key) };
  }).sort((left, right) => left.id.localeCompare(right.id));
};
var validSealedCapability = (capability) => typeof capability.token === "string" && base64urlDecodedLength(capability.token) === 32 && typeof capability.receiptTag === "string" && base64urlDecodedLength(capability.receiptTag) === 24 && typeof capability.channelTag === "string" && base64urlDecodedLength(capability.channelTag) === 24 && Number.isSafeInteger(capability.expiresAt) && Number(capability.expiresAt) >= 0;
var parseHybridEstablishmentOutboxEntry = (scope, value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_ratchet_state");
  }
  const entry = value;
  if (Object.keys(entry).length !== 6 || !UUID_RE2.test(String(entry.roadId ?? "")) || !Number.isSafeInteger(entry.revision) || Number(entry.revision) < 1 || scope !== `${entry.roadId}:${entry.revision}` || !UUID_RE2.test(String(entry.messageId ?? "")) || !Number.isSafeInteger(entry.createdAt) || Number(entry.createdAt) < 0 || !Number.isSafeInteger(entry.expiresAt) || Number(entry.expiresAt) <= Number(entry.createdAt) || typeof entry.unsignedEnvelope !== "string" || entry.unsignedEnvelope.length < 512 || entry.unsignedEnvelope.length > 64e3) throw new Error("invalid_ratchet_state");
  let unsigned;
  try {
    unsigned = JSON.parse(entry.unsignedEnvelope);
  } catch {
    throw new Error("invalid_ratchet_state");
  }
  if (!unsigned || typeof unsigned !== "object" || Array.isArray(unsigned)) {
    throw new Error("invalid_ratchet_state");
  }
  const parsed = parseRelayClientFrame(JSON.stringify({
    type: "send",
    envelope: {
      ...unsigned,
      signature: bytesToBase64url2(new Uint8Array(64))
    }
  }), Number(entry.createdAt));
  if (!parsed.ok || parsed.frame.type !== "send" || parsed.frame.envelope.payload.suite !== HYBRID_ESTABLISHMENT_SUITE || parsed.frame.envelope.roadId !== entry.roadId || parsed.frame.envelope.roadRevision !== entry.revision || parsed.frame.envelope.id !== entry.messageId || parsed.frame.envelope.createdAt !== entry.createdAt || parsed.frame.envelope.expiresAt !== entry.expiresAt) throw new Error("invalid_ratchet_state");
  return entry;
};
var validateState = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_ratchet_state");
  }
  const state = value;
  const legacy = state.protocol === LEGACY_STATE_PROTOCOL;
  const transparencyOnly = state.protocol === TRANSPARENCY_STATE_PROTOCOL;
  const sealedOnly = state.protocol === SEALED_STATE_PROTOCOL;
  const hybridOnly = state.protocol === HYBRID_STATE_PROTOCOL;
  const establishmentOnly = state.protocol === ESTABLISHMENT_STATE_PROTOCOL;
  const sealedLegacy = legacy || transparencyOnly;
  const hybridLegacy = sealedLegacy || sealedOnly;
  const establishmentLegacy = hybridLegacy || hybridOnly;
  if (!legacy && !transparencyOnly && !sealedOnly && !hybridOnly && !establishmentOnly && state.protocol !== STATE_PROTOCOL || typeof state.accountPickle !== "string" || state.accountPickle.length < 32 || state.accountPickle.length > 1e6 || !Array.isArray(state.prekeyOutbox) || state.prekeyOutbox.length > 50 || state.prekeyOutbox.some((prekey) => !prekey || typeof prekey !== "object" || !/^[A-Za-z0-9_-]{1,64}$/.test(prekey.id) || !isBase64Key(prekey.key)) || new Set(state.prekeyOutbox.map((prekey) => prekey.id)).size !== state.prekeyOutbox.length || new Set(state.prekeyOutbox.map((prekey) => prekey.key)).size !== state.prekeyOutbox.length || !hybridLegacy && (!state.hybridPrekeys || typeof state.hybridPrekeys !== "object" || Array.isArray(state.hybridPrekeys)) || !hybridLegacy && (!Array.isArray(state.hybridPrekeyOutbox) || state.hybridPrekeyOutbox.length > MAX_HYBRID_ONE_TIME_KEYS) || !establishmentLegacy && (!state.hybridEstablishmentOutbox || typeof state.hybridEstablishmentOutbox !== "object" || Array.isArray(state.hybridEstablishmentOutbox)) || !state.peers || typeof state.peers !== "object" || Array.isArray(state.peers) || !legacy && (!state.keyTransparency || typeof state.keyTransparency !== "object" || Array.isArray(state.keyTransparency)) || !sealedLegacy && (!state.inboundSealedCapabilities || typeof state.inboundSealedCapabilities !== "object" || Array.isArray(state.inboundSealedCapabilities)) || !sealedLegacy && (!state.outboundSealedCapabilities || typeof state.outboundSealedCapabilities !== "object" || Array.isArray(state.outboundSealedCapabilities)) || !sealedLegacy && (!state.sealedOutbox || typeof state.sealedOutbox !== "object" || Array.isArray(state.sealedOutbox)) || !state.sessions || typeof state.sessions !== "object" || Array.isArray(state.sessions)) throw new Error("invalid_ratchet_state");
  const keyTransparency = legacy ? {} : state.keyTransparency;
  const inboundSealedCapabilities = sealedLegacy ? {} : state.inboundSealedCapabilities;
  const outboundSealedCapabilities = sealedLegacy ? {} : state.outboundSealedCapabilities;
  const sealedOutbox = sealedLegacy ? {} : state.sealedOutbox;
  const hybridPrekeys = hybridLegacy ? {} : state.hybridPrekeys;
  const hybridPrekeyOutbox = hybridLegacy ? [] : state.hybridPrekeyOutbox;
  const hybridEstablishmentOutbox = establishmentLegacy ? {} : state.hybridEstablishmentOutbox;
  const hybridEntries = Object.entries(hybridPrekeys);
  if (hybridEntries.length > MAX_HYBRID_ONE_TIME_KEYS || new Set(hybridPrekeyOutbox).size !== hybridPrekeyOutbox.length || hybridPrekeyOutbox.some((id) => !/^[A-Za-z0-9_-]{16,64}$/.test(id) || hybridPrekeys[id]?.status !== "staged")) throw new Error("invalid_ratchet_state");
  const hybridPublicKeys = /* @__PURE__ */ new Set();
  for (const [id, prekey] of hybridEntries) {
    if (!prekey || typeof prekey !== "object" || Array.isArray(prekey) || prekey.id !== id || !/^[A-Za-z0-9_-]{16,64}$/.test(id) || !isBase64urlBytes(prekey.seed, MLKEM768_SEED_BYTES) || !isBase64urlBytes(prekey.publicKey, MLKEM768_PUBLIC_KEY_BYTES) || !isBase64urlBytes(prekey.publicKeyHash, 32) || !["staged", "published"].includes(prekey.status) || !Number.isSafeInteger(prekey.createdAt) || prekey.createdAt < 0 || prekey.roadId === null !== (prekey.revision === null) || prekey.roadId === null !== (prekey.localCity === null) || prekey.roadId !== null && !UUID_RE2.test(prekey.roadId) || prekey.revision !== null && (!Number.isSafeInteger(prekey.revision) || prekey.revision < 1) || prekey.localCity !== null && !CITY_ADDRESS_RE2.test(prekey.localCity) || prekey.status === "staged" && !hybridPrekeyOutbox.includes(id) || prekey.status === "published" && hybridPrekeyOutbox.includes(id) || hybridPublicKeys.has(prekey.publicKey)) throw new Error("invalid_ratchet_state");
    hybridPublicKeys.add(prekey.publicKey);
  }
  if (Object.keys(hybridEstablishmentOutbox).length > 64) {
    throw new Error("invalid_ratchet_state");
  }
  for (const [scope, entry] of Object.entries(hybridEstablishmentOutbox)) {
    parseHybridEstablishmentOutboxEntry(scope, entry);
  }
  for (const [deviceId, transparency] of Object.entries(keyTransparency)) {
    if (!UUID_RE2.test(deviceId) || !transparency || typeof transparency !== "object" || !Number.isSafeInteger(transparency.treeSize) || transparency.treeSize < 1 || base64urlDecodedLength(transparency.root) !== 32 || base64urlDecodedLength(transparency.mapRoot) !== 32 || base64urlDecodedLength(transparency.lastEntryHash) !== 32 || !Array.isArray(transparency.frontier) || transparency.frontier.length > 54 || transparency.frontier.some((hash) => hash !== null && base64urlDecodedLength(hash) !== 32) || !Number.isSafeInteger(transparency.timestamp) || transparency.timestamp < 0) throw new Error("invalid_ratchet_state");
    for (let level = 0; level < transparency.frontier.length; level += 1) {
      const expected = Math.floor(transparency.treeSize / 2 ** level) % 2 === 1;
      if (transparency.frontier[level] !== null !== expected) {
        throw new Error("invalid_ratchet_state");
      }
    }
  }
  for (const [deviceId, peer] of Object.entries(state.peers)) {
    if (!UUID_RE2.test(deviceId) || !peer || typeof peer !== "object" || Array.isArray(peer)) {
      throw new Error("invalid_ratchet_state");
    }
    const candidate = peer;
    if (!isBase64Key(candidate.identityKey) || !isBase64Key(candidate.signingKey) || !Number.isSafeInteger(candidate.firstSeenAt) || Number(candidate.firstSeenAt) < 0 || candidate.verifiedAt !== null && (!Number.isSafeInteger(candidate.verifiedAt) || Number(candidate.verifiedAt) < Number(candidate.firstSeenAt))) throw new Error("invalid_ratchet_state");
  }
  if (Object.keys(inboundSealedCapabilities).length > 4096) {
    throw new Error("invalid_ratchet_state");
  }
  for (const [receiptTag, capability] of Object.entries(inboundSealedCapabilities)) {
    if (!capability || typeof capability !== "object" || Array.isArray(capability) || receiptTag !== capability.receiptTag || !validSealedCapability(capability) || base64urlDecodedLength(capability.tokenHash) !== 32 || !UUID_RE2.test(capability.roadId) || !Number.isSafeInteger(capability.revision) || capability.revision < 1 || !["pending", "registered", "consumed"].includes(capability.status) || capability.sharedAt !== null && (!Number.isSafeInteger(capability.sharedAt) || capability.sharedAt < 0) || capability.consumedMessageId !== null && !UUID_RE2.test(capability.consumedMessageId) || capability.status === "pending" && capability.sharedAt !== null || capability.status === "consumed" && capability.consumedMessageId === null || capability.status !== "consumed" && capability.consumedMessageId !== null) throw new Error("invalid_ratchet_state");
  }
  let outboundCapabilityCount = 0;
  for (const [scope, capabilities] of Object.entries(outboundSealedCapabilities)) {
    const separator = scope.lastIndexOf(":");
    if (separator < 0 || !UUID_RE2.test(scope.slice(0, separator)) || !Number.isSafeInteger(Number(scope.slice(separator + 1))) || Number(scope.slice(separator + 1)) < 1 || !Array.isArray(capabilities) || capabilities.length > 256 || capabilities.some((capability) => !validSealedCapability(capability)) || new Set(capabilities.map((capability) => capability.token)).size !== capabilities.length || new Set(capabilities.map((capability) => capability.receiptTag)).size !== capabilities.length) throw new Error("invalid_ratchet_state");
    outboundCapabilityCount += capabilities.length;
  }
  if (outboundCapabilityCount > 4096 || Object.keys(sealedOutbox).length > 64) {
    throw new Error("invalid_ratchet_state");
  }
  for (const [messageId, outbox] of Object.entries(sealedOutbox)) {
    const receiptTag = outbox?.receiptTag ?? null;
    const requestBinding = outbox?.requestBinding ?? null;
    if (!UUID_RE2.test(messageId) || !outbox || typeof outbox !== "object" || Array.isArray(outbox) || !UUID_RE2.test(outbox.roadId) || !Number.isSafeInteger(outbox.revision) || outbox.revision < 1 || outbox.submission.id !== messageId || !parseSealedSubmission(outbox.submission) || receiptTag !== null && base64urlDecodedLength(receiptTag) !== 24 || requestBinding !== null && base64urlDecodedLength(requestBinding) !== 32 || requestBinding !== null && receiptTag === null || !Number.isSafeInteger(outbox.createdAt) || outbox.createdAt < 0) throw new Error("invalid_ratchet_state");
    outbox.receiptTag = receiptTag;
    outbox.requestBinding = requestBinding;
  }
  for (const [scope, session] of Object.entries(state.sessions)) {
    const separator = scope.lastIndexOf(":");
    const roadId = scope.slice(0, separator);
    const revision = Number(scope.slice(separator + 1));
    if (separator < 0 || !UUID_RE2.test(roadId) || !Number.isSafeInteger(revision) || revision < 1 || !session || typeof session !== "object" || Array.isArray(session)) {
      throw new Error("invalid_ratchet_state");
    }
    const candidate = session;
    if (!(candidate.localCity === null || typeof candidate.localCity === "string" && CITY_ADDRESS_RE2.test(candidate.localCity)) || !UUID_RE2.test(String(candidate.peerDeviceId ?? "")) || !isBase64Key(candidate.peerIdentityKey) || !isBase64Key(candidate.peerSigningKey) || typeof candidate.pickle !== "string" || candidate.pickle.length < 32 || candidate.pickle.length > 1e6 || !Number.isSafeInteger(candidate.createdAt) || Number(candidate.createdAt) < 0 || !Number.isSafeInteger(candidate.updatedAt) || Number(candidate.updatedAt) < Number(candidate.createdAt) || !candidate.pending || typeof candidate.pending !== "object" || Array.isArray(candidate.pending) || Object.keys(candidate.pending).length > MAX_PENDING_PLAINTEXTS || !Array.isArray(candidate.seen) || candidate.seen.length > MAX_SEEN_MESSAGE_IDS || !candidate.seen.every((id) => typeof id === "string" && UUID_RE2.test(id))) throw new Error("invalid_ratchet_state");
    for (const [messageId, pending] of Object.entries(candidate.pending)) {
      if (!UUID_RE2.test(messageId) || !pending || typeof pending !== "object" || Array.isArray(pending) || typeof pending.plaintext !== "string" || textEncoder.encode(pending.plaintext).byteLength > MAX_RATCHET_PLAINTEXT_BYTES || !Number.isSafeInteger(pending.receivedAt) || Number(pending.receivedAt) < 0 || !Number.isSafeInteger(pending.expiresAt) || Number(pending.expiresAt) <= Number(pending.receivedAt) || Number(pending.expiresAt) - Number(pending.receivedAt) > MAX_PENDING_PLAINTEXT_AGE_MS) throw new Error("invalid_ratchet_state");
    }
  }
  return {
    ...state,
    protocol: STATE_PROTOCOL,
    hybridPrekeys,
    hybridPrekeyOutbox,
    hybridEstablishmentOutbox,
    keyTransparency,
    inboundSealedCapabilities,
    outboundSealedCapabilities,
    sealedOutbox
  };
};
var MemoryRatchetBackend = class {
  records = /* @__PURE__ */ new Map();
  async read(key) {
    return this.records.get(key) ?? null;
  }
  async write(key, value) {
    this.records.set(key, value);
  }
  async remove(key) {
    this.records.delete(key);
  }
  /** Test/diagnostic hook. The returned value is still encrypted. */
  encryptedRecord(key = STATE_RECORD) {
    return this.records.get(key) ?? null;
  }
};
var EncryptedRatchetStateStore = class {
  constructor(backend, masterKey) {
    this.backend = backend;
    if (masterKey.byteLength !== 32) throw new Error("invalid_ratchet_master_key");
    const keyMaterial = new Uint8Array(masterKey);
    this.keyPromise = crypto.subtle.importKey(
      "raw",
      toArrayBuffer(keyMaterial),
      "AES-GCM",
      false,
      ["encrypt", "decrypt"]
    ).finally(() => keyMaterial.fill(0));
  }
  backend;
  keyPromise;
  tail = Promise.resolve();
  async update(mutation) {
    let release;
    const previous = this.tail;
    this.tail = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const current = await this.readState();
      const { state, result } = await mutation(current);
      if (state === null) await this.backend.remove(STATE_RECORD);
      else await this.writeState(validateState(state));
      return result;
    } finally {
      release();
    }
  }
  async readState() {
    const raw = await this.backend.read(STATE_RECORD);
    if (raw === null) return null;
    let value;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error("invalid_encrypted_ratchet_state");
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("invalid_encrypted_ratchet_state");
    }
    const encrypted = value;
    if (Object.keys(encrypted).length !== 3 || !Object.keys(encrypted).every((key) => ["protocol", "nonce", "ciphertext"].includes(key)) || ![
      STATE_PROTOCOL,
      ESTABLISHMENT_STATE_PROTOCOL,
      HYBRID_STATE_PROTOCOL,
      SEALED_STATE_PROTOCOL,
      TRANSPARENCY_STATE_PROTOCOL,
      LEGACY_STATE_PROTOCOL
    ].includes(String(encrypted.protocol)) || typeof encrypted.nonce !== "string" || typeof encrypted.ciphertext !== "string") throw new Error("invalid_encrypted_ratchet_state");
    const nonce = base64urlToBytes2(encrypted.nonce);
    if (nonce.byteLength !== 12) throw new Error("invalid_encrypted_ratchet_state");
    try {
      const plaintext = await crypto.subtle.decrypt({
        name: "AES-GCM",
        iv: toArrayBuffer(nonce),
        additionalData: toArrayBuffer(textEncoder.encode(encrypted.protocol)),
        tagLength: 128
      }, await this.keyPromise, toArrayBuffer(base64urlToBytes2(encrypted.ciphertext)));
      return validateState(JSON.parse(textDecoder.decode(plaintext)));
    } catch (error) {
      if (error instanceof Error && error.message === "invalid_ratchet_state") throw error;
      throw new Error("ratchet_state_decryption_failed");
    }
  }
  async writeState(state) {
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({
      name: "AES-GCM",
      iv: toArrayBuffer(nonce),
      additionalData: toArrayBuffer(textEncoder.encode(STATE_PROTOCOL)),
      tagLength: 128
    }, await this.keyPromise, toArrayBuffer(textEncoder.encode(JSON.stringify(state))));
    const encrypted = {
      protocol: STATE_PROTOCOL,
      nonce: bytesToBase64url2(nonce),
      ciphertext: bytesToBase64url2(new Uint8Array(ciphertext))
    };
    await this.backend.write(STATE_RECORD, JSON.stringify(encrypted));
  }
};
var requireInitialized = (state) => {
  if (!state) throw new Error("ratchet_identity_not_initialized");
  return state;
};
var requireRoadId = (roadId) => {
  if (!UUID_RE2.test(roadId)) throw new Error("invalid_ratchet_road_id");
};
var requireRevision = (revision) => {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error("invalid_ratchet_road_revision");
  }
};
var roadScope = (roadId, revision) => {
  requireRoadId(roadId);
  requireRevision(revision);
  return `${roadId}:${revision}`;
};
var requireMessageId = (messageId) => {
  if (!UUID_RE2.test(messageId)) throw new Error("invalid_ratchet_message_id");
};
var requirePeerDescriptor = (peer) => {
  if (!UUID_RE2.test(peer.deviceId)) throw new Error("invalid_ratchet_peer_device");
  if (!isBase64Key(peer.identityKey)) throw new Error("invalid_ratchet_peer_identity");
  if (!isBase64Key(peer.signingKey)) throw new Error("invalid_ratchet_peer_signing_key");
};
var pinPeer = (state, peer, now) => {
  requirePeerDescriptor(peer);
  const pinned = state.peers[peer.deviceId];
  if (pinned) {
    if (pinned.identityKey !== peer.identityKey || pinned.signingKey !== peer.signingKey) {
      throw new Error("ratchet_peer_identity_changed");
    }
    return pinned;
  }
  const created = {
    identityKey: peer.identityKey,
    signingKey: peer.signingKey,
    firstSeenAt: now,
    verifiedAt: null
  };
  state.peers[peer.deviceId] = created;
  return created;
};
var rememberSeen = (session, messageId) => {
  if (!session.seen.includes(messageId)) session.seen.push(messageId);
  if (session.seen.length > MAX_SEEN_MESSAGE_IDS) {
    session.seen.splice(0, session.seen.length - MAX_SEEN_MESSAGE_IDS);
  }
};
var pruneExpiredPending = (session, now) => {
  let removed = 0;
  for (const [messageId, pending] of Object.entries(session.pending)) {
    if (pending.expiresAt > now) continue;
    delete session.pending[messageId];
    rememberSeen(session, messageId);
    removed += 1;
  }
  if (removed) session.updatedAt = Math.max(session.updatedAt, now);
  return removed;
};
var pruneSealedState = (state, now) => {
  for (const [receiptTag, capability] of Object.entries(state.inboundSealedCapabilities)) {
    if (capability.expiresAt + MAX_SEALED_MESSAGE_LIFETIME_MS <= now) {
      delete state.inboundSealedCapabilities[receiptTag];
    }
  }
  for (const [scope, capabilities] of Object.entries(state.outboundSealedCapabilities)) {
    const active = capabilities.filter((capability) => capability.expiresAt > now);
    if (active.length) state.outboundSealedCapabilities[scope] = active;
    else delete state.outboundSealedCapabilities[scope];
  }
  for (const [messageId, outbox] of Object.entries(state.sealedOutbox)) {
    if (outbox.createdAt + MAX_SEALED_MESSAGE_LIFETIME_MS <= now) {
      delete state.sealedOutbox[messageId];
    }
  }
};
var removeSealedRoadState = (state, roadId, revision) => {
  const scope = roadScope(roadId, revision);
  const channelTags = /* @__PURE__ */ new Set();
  for (const [receiptTag, capability] of Object.entries(state.inboundSealedCapabilities)) {
    if (capability.roadId === roadId && capability.revision === revision) {
      channelTags.add(capability.channelTag);
      delete state.inboundSealedCapabilities[receiptTag];
    }
  }
  delete state.outboundSealedCapabilities[scope];
  for (const [messageId, outbox] of Object.entries(state.sealedOutbox)) {
    if (outbox.roadId === roadId && outbox.revision === revision) {
      delete state.sealedOutbox[messageId];
    }
  }
  return [...channelTags];
};
var removeHybridRoadPrekeys = (state, roadId, revision) => {
  let removed = 0;
  for (const [id, prekey] of Object.entries(state.hybridPrekeys)) {
    if (prekey.roadId !== roadId || revision !== void 0 && prekey.revision !== revision) continue;
    try {
      base64urlToBytes2(prekey.seed).fill(0);
    } catch {
    }
    delete state.hybridPrekeys[id];
    state.hybridPrekeyOutbox = state.hybridPrekeyOutbox.filter((candidate) => candidate !== id);
    removed += 1;
  }
  for (const [scope, pending] of Object.entries(state.hybridEstablishmentOutbox)) {
    if (pending.roadId !== roadId || revision !== void 0 && pending.revision !== revision) continue;
    delete state.hybridEstablishmentOutbox[scope];
    removed += 1;
  }
  return removed;
};
var parseWireMessage = (message) => {
  if (!message || typeof message !== "object" || message.suite !== ROAD_RATCHET_SUITE || ![0, 1].includes(message.type) || typeof message.body !== "string" || message.body.length < 16 || message.body.length > 32e3) throw new Error("invalid_ratchet_message");
  return message;
};
var publicBundle = (account) => ({
  ...parseIdentityKeys(account.identityKeys()),
  oneTimeKeys: parseOneTimeKeys(account.oneTimeKeys())
});
var encryptWithState = (state, roadId, plaintext, options, now) => {
  const scope = roadScope(roadId, options.revision ?? 1);
  pinPeer(state, {
    deviceId: options.peerDeviceId,
    identityKey: options.peerIdentityKey,
    signingKey: options.peerSigningKey
  }, now);
  let persisted = state.sessions[scope];
  let session;
  if (persisted) {
    pruneExpiredPending(persisted, now);
    if (persisted.peerDeviceId !== options.peerDeviceId || options.localCity !== void 0 && persisted.localCity !== options.localCity || persisted.peerIdentityKey !== options.peerIdentityKey || persisted.peerSigningKey !== options.peerSigningKey) throw new Error("ratchet_peer_identity_changed");
    session = Session.fromPickle(persisted.pickle);
  } else {
    if (!options.peerOneTimeKey) throw new Error("ratchet_session_not_initialized");
    const account = Account.fromPickle(state.accountPickle);
    try {
      session = account.createOutboundSession(options.peerIdentityKey, options.peerOneTimeKey);
    } finally {
      account.free();
    }
    persisted = {
      localCity: options.localCity ?? null,
      peerDeviceId: options.peerDeviceId,
      peerIdentityKey: options.peerIdentityKey,
      peerSigningKey: options.peerSigningKey,
      pickle: "",
      createdAt: now,
      updatedAt: now,
      pending: {},
      seen: []
    };
    state.sessions[scope] = persisted;
  }
  try {
    const encrypted = JSON.parse(session.encrypt(plaintext));
    if (![0, 1].includes(Number(encrypted.type)) || typeof encrypted.body !== "string") {
      throw new Error("ratchet_encrypt_failed");
    }
    persisted.pickle = session.pickle();
    persisted.updatedAt = now;
    return {
      suite: ROAD_RATCHET_SUITE,
      type: Number(encrypted.type),
      body: encrypted.body
    };
  } finally {
    session.free();
  }
};
var decryptWithState = (state, roadId, messageId, message, options, now, pendingExpiresAt) => {
  const scope = roadScope(roadId, options.revision ?? 1);
  pinPeer(state, {
    deviceId: options.peerDeviceId,
    identityKey: options.peerIdentityKey,
    signingKey: options.peerSigningKey
  }, now);
  let persisted = state.sessions[scope];
  if (persisted) pruneExpiredPending(persisted, now);
  if (persisted?.seen.includes(messageId)) return { status: "duplicate" };
  const cached = persisted?.pending[messageId];
  if (cached) return { status: "pending", plaintext: cached.plaintext };
  let session;
  let plaintext;
  if (persisted) {
    if (persisted.peerDeviceId !== options.peerDeviceId || options.localCity !== void 0 && persisted.localCity !== options.localCity || persisted.peerIdentityKey !== options.peerIdentityKey || persisted.peerSigningKey !== options.peerSigningKey) throw new Error("ratchet_peer_identity_changed");
    session = Session.fromPickle(persisted.pickle);
    try {
      plaintext = session.decrypt(message.type, message.body);
      persisted.pickle = session.pickle();
    } finally {
      session.free();
    }
  } else {
    if (options.requireExistingSession) throw new Error("hybrid_downgrade_detected");
    if (message.type !== 0) throw new Error("ratchet_prekey_message_required");
    const account = Account.fromPickle(state.accountPickle);
    try {
      const inbound = account.createInboundSession(message.body);
      try {
        if (inbound.senderIdentityKey !== options.peerIdentityKey) {
          throw new Error("ratchet_sender_identity_mismatch");
        }
        plaintext = inbound.plaintext;
        session = inbound.takeSession();
      } finally {
        inbound.free();
      }
      persisted = {
        localCity: options.localCity ?? null,
        peerDeviceId: options.peerDeviceId,
        peerIdentityKey: options.peerIdentityKey,
        peerSigningKey: options.peerSigningKey,
        pickle: session.pickle(),
        createdAt: now,
        updatedAt: now,
        pending: {},
        seen: []
      };
      session.free();
      state.accountPickle = account.pickle();
      state.sessions[scope] = persisted;
    } finally {
      account.free();
    }
  }
  if (textEncoder.encode(plaintext).byteLength > MAX_RATCHET_PLAINTEXT_BYTES) {
    throw new Error("ratchet_plaintext_too_large");
  }
  if (Object.keys(persisted.pending).length >= MAX_PENDING_PLAINTEXTS) {
    throw new Error("ratchet_pending_limit");
  }
  persisted.pending[messageId] = { plaintext, receivedAt: now, expiresAt: pendingExpiresAt };
  persisted.updatedAt = now;
  return { status: "pending", plaintext };
};
var RoadRatchet = class {
  constructor(store) {
    this.store = store;
  }
  store;
  hybridOutbox(state) {
    return state.hybridPrekeyOutbox.map((id) => {
      const prekey = state.hybridPrekeys[id];
      if (!prekey || prekey.status !== "staged") throw new Error("invalid_ratchet_state");
      return { id: prekey.id, publicKey: prekey.publicKey };
    });
  }
  async appendHybridPrekeys(state, count, now) {
    if (Object.keys(state.hybridPrekeys).length + count > MAX_HYBRID_ONE_TIME_KEYS) {
      throw new Error("hybrid_prekey_capacity_exceeded");
    }
    for (let index = 0; index < count; index += 1) {
      let id = randomBase64url(24);
      while (state.hybridPrekeys[id]) id = randomBase64url(24);
      const generated = await generateMlKem768Prekey();
      const publicKeyBytes = base64urlToBytes2(generated.publicKey);
      let publicKeyHash;
      try {
        publicKeyHash = await sha256Base64url2(publicKeyBytes);
      } finally {
        publicKeyBytes.fill(0);
      }
      state.hybridPrekeys[id] = {
        id,
        seed: generated.seed,
        publicKey: generated.publicKey,
        publicKeyHash,
        status: "staged",
        createdAt: now,
        roadId: null,
        revision: null,
        localCity: null
      };
      state.hybridPrekeyOutbox.push(id);
    }
    return this.hybridOutbox(state);
  }
  async initialize(prekeyCount = DEFAULT_ONE_TIME_KEYS) {
    await ensureRatchetWasm();
    if (!Number.isSafeInteger(prekeyCount) || prekeyCount < 1 || prekeyCount > 50) {
      throw new Error("invalid_ratchet_prekey_count");
    }
    return this.store.update((state) => {
      if (state) throw new Error("ratchet_identity_already_initialized");
      const account = new Account();
      try {
        account.generateOneTimeKeys(prekeyCount);
        const bundle = publicBundle(account);
        account.markKeysAsPublished();
        return {
          state: {
            protocol: STATE_PROTOCOL,
            accountPickle: account.pickle(),
            prekeyOutbox: [],
            hybridPrekeys: {},
            hybridPrekeyOutbox: [],
            hybridEstablishmentOutbox: {},
            peers: {},
            keyTransparency: {},
            inboundSealedCapabilities: {},
            outboundSealedCapabilities: {},
            sealedOutbox: {},
            sessions: {}
          },
          result: bundle
        };
      } finally {
        account.free();
      }
    });
  }
  async initializeHybridPrekeys(count = DEFAULT_HYBRID_ONE_TIME_KEYS) {
    if (!Number.isSafeInteger(count) || count < 1 || count > DEFAULT_HYBRID_ONE_TIME_KEYS) {
      throw new Error("invalid_hybrid_prekey_count");
    }
    const now = Date.now();
    return this.store.update(async (current) => {
      const state = requireInitialized(current);
      if (state.hybridPrekeyOutbox.length) {
        return { state, result: this.hybridOutbox(state) };
      }
      if (Object.keys(state.hybridPrekeys).length) {
        throw new Error("hybrid_prekeys_already_initialized");
      }
      const result = await this.appendHybridPrekeys(state, count, now);
      return { state, result };
    });
  }
  async replenishHybridPrekeys(count = DEFAULT_HYBRID_ONE_TIME_KEYS) {
    if (!Number.isSafeInteger(count) || count < 1 || count > DEFAULT_HYBRID_ONE_TIME_KEYS) {
      throw new Error("invalid_hybrid_prekey_count");
    }
    const now = Date.now();
    return this.store.update(async (current) => {
      const state = requireInitialized(current);
      if (state.hybridPrekeyOutbox.length) {
        return { state, result: this.hybridOutbox(state) };
      }
      const result = await this.appendHybridPrekeys(state, count, now);
      return { state, result };
    });
  }
  async confirmPublishedHybridPrekeys(keyIds) {
    if (!Array.isArray(keyIds) || keyIds.length < 1 || keyIds.length > DEFAULT_HYBRID_ONE_TIME_KEYS || keyIds.some((id) => typeof id !== "string" || !/^[A-Za-z0-9_-]{16,64}$/.test(id)) || new Set(keyIds).size !== keyIds.length) throw new Error("invalid_hybrid_prekey_confirmation");
    return this.store.update((current) => {
      const state = requireInitialized(current);
      if (state.hybridPrekeyOutbox.length === 0 && keyIds.every((id) => state.hybridPrekeys[id]?.status === "published")) return { state, result: false };
      const expected = [...state.hybridPrekeyOutbox].sort();
      const supplied = [...keyIds].sort();
      if (expected.length !== supplied.length || expected.some((id, index) => id !== supplied[index])) throw new Error("hybrid_prekey_confirmation_mismatch");
      for (const id of expected) {
        const prekey = state.hybridPrekeys[id];
        if (!prekey || prekey.status !== "staged") throw new Error("invalid_ratchet_state");
        prekey.status = "published";
      }
      state.hybridPrekeyOutbox = [];
      return { state, result: true };
    });
  }
  async hybridPrekeyCounts() {
    return this.store.update((current) => {
      const state = requireInitialized(current);
      const counts = { staged: 0, published: 0 };
      for (const prekey of Object.values(state.hybridPrekeys)) counts[prekey.status] += 1;
      return { state, result: counts };
    });
  }
  async bindHybridPrekeyToRoad(keyId, roadId, revision, localCity) {
    const scope = roadScope(roadId, revision);
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(keyId)) throw new Error("invalid_hybrid_prekey_id");
    if (!CITY_ADDRESS_RE2.test(localCity)) throw new Error("invalid_ratchet_local_city");
    return this.store.update((current) => {
      const state = requireInitialized(current);
      const prekey = state.hybridPrekeys[keyId];
      if (!prekey) throw new Error("hybrid_prekey_not_found");
      if (prekey.roadId !== null || prekey.revision !== null) {
        if (`${prekey.roadId}:${prekey.revision}` !== scope || prekey.localCity !== localCity) {
          throw new Error("hybrid_prekey_assignment_changed");
        }
        return { state, result: false };
      }
      if (Object.values(state.hybridPrekeys).some((candidate) => candidate.roadId === roadId && candidate.revision === revision)) throw new Error("hybrid_road_prekey_already_bound");
      prekey.roadId = roadId;
      prekey.revision = revision;
      prekey.localCity = localCity;
      return { state, result: true };
    });
  }
  async identity() {
    await ensureRatchetWasm();
    return this.store.update((current) => {
      const state = requireInitialized(current);
      const account = Account.fromPickle(state.accountPickle);
      try {
        return { state, result: parseIdentityKeys(account.identityKeys()) };
      } finally {
        account.free();
      }
    });
  }
  async replenishOneTimeKeys(count = DEFAULT_ONE_TIME_KEYS) {
    await ensureRatchetWasm();
    if (!Number.isSafeInteger(count) || count < 1 || count > 50) {
      throw new Error("invalid_ratchet_prekey_count");
    }
    return this.store.update((current) => {
      const state = requireInitialized(current);
      if (state.prekeyOutbox.length) {
        const account2 = Account.fromPickle(state.accountPickle);
        try {
          const identity = parseIdentityKeys(account2.identityKeys());
          return {
            state,
            result: { ...identity, oneTimeKeys: state.prekeyOutbox.map((prekey) => ({ ...prekey })) }
          };
        } finally {
          account2.free();
        }
      }
      const account = Account.fromPickle(state.accountPickle);
      try {
        account.generateOneTimeKeys(count);
        const bundle = publicBundle(account);
        account.markKeysAsPublished();
        state.accountPickle = account.pickle();
        state.prekeyOutbox = bundle.oneTimeKeys.map((prekey) => ({ ...prekey }));
        return { state, result: bundle };
      } finally {
        account.free();
      }
    });
  }
  async confirmPublishedOneTimeKeys(keyIds) {
    if (!Array.isArray(keyIds) || keyIds.length < 1 || keyIds.length > 50 || keyIds.some((id) => typeof id !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) || new Set(keyIds).size !== keyIds.length) throw new Error("invalid_ratchet_prekey_confirmation");
    return this.store.update((current) => {
      const state = requireInitialized(current);
      const expected = [...state.prekeyOutbox.map((prekey) => prekey.id)].sort();
      const supplied = [...keyIds].sort();
      if (!expected.length || expected.join("\n") !== supplied.join("\n")) {
        throw new Error("ratchet_prekey_confirmation_mismatch");
      }
      state.prekeyOutbox = [];
      return { state, result: true };
    });
  }
  async ensureInboundSealedCapabilities(roadId, revision = 1, desired = DEFAULT_SEALED_CAPABILITY_POOL, now = Date.now()) {
    const scope = roadScope(roadId, revision);
    if (!Number.isSafeInteger(desired) || desired < 1 || desired > MAX_SEALED_CAPABILITIES_PER_BATCH || !Number.isSafeInteger(now) || now < 0) throw new Error("invalid_sealed_capability_request");
    return this.store.update(async (current) => {
      const state = requireInitialized(current);
      pruneSealedState(state, now);
      const scoped = Object.values(state.inboundSealedCapabilities).filter((capability) => roadScope(capability.roadId, capability.revision) === scope && capability.status !== "consumed" && capability.expiresAt > now + SEALED_CAPABILITY_REFRESH_HORIZON_MS);
      const channelTag = scoped[0]?.channelTag ?? randomBase64url(24);
      const needed = Math.max(0, desired - scoped.length);
      if (Object.keys(state.inboundSealedCapabilities).length + needed > 4096) {
        throw new Error("sealed_capability_state_full");
      }
      for (let index = 0; index < needed; index += 1) {
        const token = randomBase64url(32);
        const receiptTag = randomBase64url(24);
        const capability = {
          token,
          tokenHash: await sha256Base64url2(token),
          receiptTag,
          channelTag,
          expiresAt: now + MAX_SEALED_CAPABILITY_TTL_MS,
          roadId,
          revision,
          status: "pending",
          sharedAt: null,
          consumedMessageId: null
        };
        state.inboundSealedCapabilities[receiptTag] = capability;
      }
      const pending = Object.values(state.inboundSealedCapabilities).filter((capability) => capability.roadId === roadId && capability.revision === revision && capability.status === "pending" && capability.expiresAt > now).map((capability) => ({
        tokenHash: capability.tokenHash,
        receiptTag: capability.receiptTag,
        channelTag: capability.channelTag,
        expiresAt: capability.expiresAt
      }));
      return { state, result: pending };
    });
  }
  async confirmInboundSealedCapabilities(receiptTags, now = Date.now()) {
    if (!Array.isArray(receiptTags) || receiptTags.length < 1 || receiptTags.length > MAX_SEALED_CAPABILITIES_PER_BATCH || receiptTags.some((tag) => base64urlDecodedLength(tag) !== 24) || new Set(receiptTags).size !== receiptTags.length) throw new Error("invalid_sealed_capability_confirmation");
    return this.store.update((current) => {
      const state = requireInitialized(current);
      pruneSealedState(state, now);
      for (const tag of receiptTags) {
        const capability = state.inboundSealedCapabilities[tag];
        if (!capability || capability.status !== "pending" || capability.expiresAt <= now) {
          throw new Error("sealed_capability_confirmation_mismatch");
        }
      }
      for (const tag of receiptTags) state.inboundSealedCapabilities[tag].status = "registered";
      return { state, result: true };
    });
  }
  async unsharedInboundSealedCapabilities(roadId, revision = 1, now = Date.now()) {
    roadScope(roadId, revision);
    return this.store.update((current) => {
      const state = requireInitialized(current);
      pruneSealedState(state, now);
      return {
        state,
        result: Object.values(state.inboundSealedCapabilities).filter((capability) => capability.roadId === roadId && capability.revision === revision && capability.status === "registered" && capability.sharedAt === null && capability.expiresAt > now).slice(0, MAX_SEALED_CAPABILITIES_PER_BATCH).map(({ token, receiptTag, channelTag, expiresAt }) => ({
          token,
          receiptTag,
          channelTag,
          expiresAt
        }))
      };
    });
  }
  async confirmSharedInboundSealedCapabilities(receiptTags, now = Date.now()) {
    if (!Array.isArray(receiptTags) || receiptTags.length < 1 || receiptTags.length > MAX_SEALED_CAPABILITIES_PER_BATCH || receiptTags.some((tag) => base64urlDecodedLength(tag) !== 24) || new Set(receiptTags).size !== receiptTags.length) throw new Error("invalid_sealed_capability_share");
    return this.store.update((current) => {
      const state = requireInitialized(current);
      for (const tag of receiptTags) {
        const capability = state.inboundSealedCapabilities[tag];
        if (!capability || capability.status !== "registered") {
          throw new Error("sealed_capability_share_mismatch");
        }
      }
      for (const tag of receiptTags) state.inboundSealedCapabilities[tag].sharedAt = now;
      return { state, result: true };
    });
  }
  async acceptOutboundSealedCapabilities(roadId, revision, capabilities, now = Date.now()) {
    const scope = roadScope(roadId, revision);
    if (!Array.isArray(capabilities) || capabilities.length < 1 || capabilities.length > MAX_SEALED_CAPABILITIES_PER_BATCH || capabilities.some((capability) => !validSealedCapability(capability) || capability.expiresAt <= now || capability.expiresAt - now > MAX_SEALED_CAPABILITY_TTL_MS) || new Set(capabilities.map((capability) => capability.token)).size !== capabilities.length || new Set(capabilities.map((capability) => capability.receiptTag)).size !== capabilities.length || new Set(capabilities.map((capability) => capability.channelTag)).size !== 1) throw new Error("invalid_sealed_capability_grant");
    return this.store.update((current) => {
      const state = requireInitialized(current);
      pruneSealedState(state, now);
      const scoped = state.outboundSealedCapabilities[scope] ?? [];
      const byReceipt = new Map(scoped.map((capability) => [capability.receiptTag, capability]));
      const all = Object.values(state.outboundSealedCapabilities).flat();
      for (const capability of capabilities) {
        const existing = byReceipt.get(capability.receiptTag);
        if (existing) {
          if (JSON.stringify(existing) !== JSON.stringify(capability)) {
            throw new Error("sealed_capability_grant_conflict");
          }
          continue;
        }
        if (all.some((candidate) => candidate.token === capability.token || candidate.receiptTag === capability.receiptTag)) {
          throw new Error("sealed_capability_cross_road_reuse");
        }
        scoped.push({ ...capability });
        all.push(capability);
      }
      if (all.length > 4096 || scoped.length > MAX_SEALED_CAPABILITIES_PER_ROAD) {
        throw new Error("sealed_capability_state_full");
      }
      state.outboundSealedCapabilities[scope] = scoped.sort(
        (left, right) => left.expiresAt - right.expiresAt || left.receiptTag.localeCompare(right.receiptTag)
      );
      return { state, result: scoped.length };
    });
  }
  async outboundSealedCapabilityCount(roadId, revision, now = Date.now()) {
    const scope = roadScope(roadId, revision);
    return this.store.update((current) => {
      const state = requireInitialized(current);
      pruneSealedState(state, now);
      return {
        state,
        result: (state.outboundSealedCapabilities[scope] ?? []).filter((capability) => capability.expiresAt > now + MIN_SEALED_CAPABILITY_TTL_MS).length
      };
    });
  }
  async createSealedSubmission(roadId, revision, plaintext, options) {
    await ensureRatchetWasm();
    const scope = roadScope(roadId, revision);
    if (typeof plaintext !== "function") throw new Error("sealed_plaintext_builder_required");
    requirePeerDescriptor({
      deviceId: options.peerDeviceId,
      identityKey: options.peerIdentityKey,
      signingKey: options.peerSigningKey
    });
    if (options.localCity !== void 0 && !CITY_ADDRESS_RE2.test(options.localCity)) {
      throw new Error("invalid_ratchet_local_city");
    }
    const now = options.now ?? Date.now();
    if (!Number.isSafeInteger(now) || now < 0) throw new Error("invalid_ratchet_message_time");
    if (options.messageId !== void 0) requireMessageId(options.messageId);
    if (options.messageId !== void 0 && base64urlDecodedLength(options.requestBinding ?? "") !== 32) throw new Error("sealed_request_binding_required");
    if (options.requestBinding !== void 0 && base64urlDecodedLength(options.requestBinding) !== 32) throw new Error("invalid_sealed_request_binding");
    const messageId = options.messageId ?? crypto.randomUUID();
    const requestBinding = options.requestBinding ?? null;
    const {
      messageId: _messageId,
      requestBinding: _requestBinding,
      ...encryptOptions
    } = options;
    return this.store.update((current) => {
      const state = requireInitialized(current);
      pruneSealedState(state, now);
      if (!state.sessions[scope]) throw new Error("hybrid_establishment_required");
      const existing = state.sealedOutbox[messageId];
      if (existing) {
        if (existing.roadId !== roadId || existing.revision !== revision || existing.requestBinding === null || existing.requestBinding !== requestBinding || existing.receiptTag === null) throw new Error("sealed_message_id_conflict");
        return {
          state,
          result: {
            submission: structuredClone(existing.submission),
            receiptTag: existing.receiptTag
          }
        };
      }
      if (Object.keys(state.sealedOutbox).length >= 64) throw new Error("sealed_outbox_full");
      const available = state.outboundSealedCapabilities[scope] ?? [];
      const index = available.findIndex((capability2) => capability2.expiresAt > now + MIN_SEALED_CAPABILITY_TTL_MS);
      if (index < 0) throw new Error("sealed_capability_unavailable");
      const [capability] = available.splice(index, 1);
      if (!capability) throw new Error("sealed_capability_unavailable");
      if (!available.length) delete state.outboundSealedCapabilities[scope];
      const cleartext = plaintext({ ...capability }, messageId);
      if (typeof cleartext !== "string" || cleartext.length < 1 || textEncoder.encode(cleartext).byteLength > MAX_RATCHET_PLAINTEXT_BYTES) throw new Error("ratchet_plaintext_too_large");
      const wire = encryptWithState(
        state,
        roadId,
        cleartext,
        { ...encryptOptions, revision },
        now
      );
      const submission = {
        protocol: SEALED_SENDER_PROTOCOL,
        id: messageId,
        capability: capability.token,
        payload: {
          suite: SEALED_SUITE,
          messageType: wire.type,
          ciphertext: wire.body
        }
      };
      if (!parseSealedSubmission(submission)) throw new Error("sealed_submission_invalid");
      state.sealedOutbox[messageId] = {
        roadId,
        revision,
        submission,
        receiptTag: capability.receiptTag,
        requestBinding,
        createdAt: now
      };
      return {
        state,
        result: { submission, receiptTag: capability.receiptTag }
      };
    });
  }
  async pendingSealedSubmissions(roadId, revision) {
    if (roadId === void 0 !== (revision === void 0)) {
      throw new Error("invalid_sealed_outbox_scope");
    }
    if (roadId !== void 0 && revision !== void 0) roadScope(roadId, revision);
    return this.store.update((current) => {
      const state = requireInitialized(current);
      pruneSealedState(state, Date.now());
      return {
        state,
        result: Object.values(state.sealedOutbox).filter((entry) => roadId === void 0 || entry.roadId === roadId && entry.revision === revision).sort((left, right) => left.createdAt - right.createdAt).map((entry) => ({
          roadId: entry.roadId,
          revision: entry.revision,
          submission: structuredClone(entry.submission),
          receiptTag: entry.receiptTag,
          requestBinding: entry.requestBinding,
          createdAt: entry.createdAt
        }))
      };
    });
  }
  async confirmSealedSubmission(messageId) {
    requireMessageId(messageId);
    return this.store.update((current) => {
      const state = requireInitialized(current);
      const existed = Boolean(state.sealedOutbox[messageId]);
      delete state.sealedOutbox[messageId];
      return { state, result: existed };
    });
  }
  async resolveInboundSealedCapability(receiptTag, messageId, now = Date.now()) {
    if (base64urlDecodedLength(receiptTag) !== 24) {
      throw new Error("invalid_sealed_receipt_tag");
    }
    requireMessageId(messageId);
    return this.store.update((current) => {
      const state = requireInitialized(current);
      pruneSealedState(state, now);
      const capability = state.inboundSealedCapabilities[receiptTag];
      if (!capability || capability.status === "pending" || capability.status === "consumed" && capability.consumedMessageId !== messageId) throw new Error("sealed_capability_not_recognized");
      return {
        state,
        result: {
          roadId: capability.roadId,
          revision: capability.revision,
          duplicate: capability.status === "consumed"
        }
      };
    });
  }
  async commitInboundSealedCapability(receiptTag, messageId) {
    if (base64urlDecodedLength(receiptTag) !== 24) {
      throw new Error("invalid_sealed_receipt_tag");
    }
    requireMessageId(messageId);
    return this.store.update((current) => {
      const state = requireInitialized(current);
      const capability = state.inboundSealedCapabilities[receiptTag];
      if (!capability || capability.status === "pending") {
        throw new Error("sealed_capability_not_recognized");
      }
      if (capability.status === "consumed") {
        if (capability.consumedMessageId !== messageId) {
          throw new Error("sealed_capability_message_mismatch");
        }
        return { state, result: false };
      }
      capability.status = "consumed";
      capability.consumedMessageId = messageId;
      return { state, result: true };
    });
  }
  async revokeSealedRoad(roadId, revision) {
    roadScope(roadId, revision);
    return this.store.update((current) => {
      const state = requireInitialized(current);
      return { state, result: removeSealedRoadState(state, roadId, revision) };
    });
  }
  async encrypt(roadId, plaintext, options) {
    await ensureRatchetWasm();
    roadScope(roadId, options.revision ?? 1);
    if (typeof plaintext !== "string" || !plaintext.length) throw new Error("ratchet_plaintext_required");
    if (textEncoder.encode(plaintext).byteLength > MAX_RATCHET_PLAINTEXT_BYTES) {
      throw new Error("ratchet_plaintext_too_large");
    }
    requirePeerDescriptor({
      deviceId: options.peerDeviceId,
      identityKey: options.peerIdentityKey,
      signingKey: options.peerSigningKey
    });
    if (options.localCity !== void 0 && !CITY_ADDRESS_RE2.test(options.localCity)) {
      throw new Error("invalid_ratchet_local_city");
    }
    if (options.peerOneTimeKey !== void 0 && !isBase64Key(options.peerOneTimeKey)) {
      throw new Error("invalid_ratchet_peer_prekey");
    }
    const now = options.now ?? Date.now();
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new Error("invalid_ratchet_message_time");
    }
    return this.store.update((current) => {
      const state = requireInitialized(current);
      return { state, result: encryptWithState(state, roadId, plaintext, options, now) };
    });
  }
  async encryptHybridEstablishment(roadId, plaintext, options, wrap) {
    await ensureRatchetWasm();
    const scope = roadScope(roadId, options.revision ?? 1);
    if (typeof plaintext !== "string" || !plaintext.length) throw new Error("ratchet_plaintext_required");
    if (textEncoder.encode(plaintext).byteLength > MAX_RATCHET_PLAINTEXT_BYTES) {
      throw new Error("ratchet_plaintext_too_large");
    }
    requirePeerDescriptor({
      deviceId: options.peerDeviceId,
      identityKey: options.peerIdentityKey,
      signingKey: options.peerSigningKey
    });
    if (!options.peerOneTimeKey || !isBase64Key(options.peerOneTimeKey)) {
      throw new Error("invalid_ratchet_peer_prekey");
    }
    if (options.localCity !== void 0 && !CITY_ADDRESS_RE2.test(options.localCity)) {
      throw new Error("invalid_ratchet_local_city");
    }
    if (typeof wrap !== "function") throw new Error("hybrid_wrapper_required");
    const now = options.now ?? Date.now();
    if (!Number.isSafeInteger(now) || now < 0) throw new Error("invalid_ratchet_message_time");
    return this.store.update((current) => {
      const state = requireInitialized(current);
      if (state.sessions[scope]) throw new Error("hybrid_establishment_already_complete");
      if (state.hybridEstablishmentOutbox[scope]) {
        throw new Error("hybrid_establishment_already_pending");
      }
      if (Object.keys(state.hybridEstablishmentOutbox).length >= 64) {
        throw new Error("hybrid_establishment_outbox_full");
      }
      const wire = encryptWithState(state, roadId, plaintext, options, now);
      if (wire.type !== 0) throw new Error("hybrid_establishment_prekey_message_required");
      const result = wrap(wire);
      if (typeof result !== "string" || !result.length) throw new Error("hybrid_wrapper_failed");
      let unsigned;
      try {
        unsigned = JSON.parse(result);
      } catch {
        throw new Error("hybrid_wrapper_failed");
      }
      const entry = {
        roadId,
        revision: options.revision ?? 1,
        messageId: String(unsigned.id ?? ""),
        createdAt: Number(unsigned.createdAt),
        expiresAt: Number(unsigned.expiresAt),
        unsignedEnvelope: result
      };
      parseHybridEstablishmentOutboxEntry(scope, entry);
      if (entry.createdAt !== now) throw new Error("hybrid_wrapper_failed");
      state.hybridEstablishmentOutbox[scope] = entry;
      return { state, result };
    });
  }
  async pendingHybridEstablishment(roadId, revision = 1, now = Date.now()) {
    const scope = roadScope(roadId, revision);
    if (!Number.isSafeInteger(now) || now < 0) throw new Error("invalid_ratchet_message_time");
    return this.store.update((current) => {
      const state = requireInitialized(current);
      const pending = state.hybridEstablishmentOutbox[scope];
      if (!pending) return { state, result: null };
      if (pending.expiresAt <= now) throw new Error("hybrid_establishment_expired");
      return { state, result: pending.unsignedEnvelope };
    });
  }
  async confirmHybridEstablishmentQueued(roadId, revision, messageId) {
    const scope = roadScope(roadId, revision);
    requireMessageId(messageId);
    return this.store.update((current) => {
      const state = requireInitialized(current);
      const pending = state.hybridEstablishmentOutbox[scope];
      if (!pending) return { state, result: false };
      if (pending.messageId !== messageId) throw new Error("hybrid_establishment_ack_mismatch");
      delete state.hybridEstablishmentOutbox[scope];
      return { state, result: true };
    });
  }
  async decryptHybridEstablishment(roadId, messageId, keyId, expectedPublicKeyHash, open2, options) {
    await ensureRatchetWasm();
    const revision = options.revision ?? 1;
    const scope = roadScope(roadId, revision);
    requireMessageId(messageId);
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(keyId)) throw new Error("invalid_hybrid_prekey_id");
    if (!isBase64urlBytes(expectedPublicKeyHash, 32)) {
      throw new Error("invalid_mlkem768_public_key_hash");
    }
    if (typeof open2 !== "function") throw new Error("hybrid_opener_required");
    requirePeerDescriptor({
      deviceId: options.peerDeviceId,
      identityKey: options.peerIdentityKey,
      signingKey: options.peerSigningKey
    });
    if (options.localCity !== void 0 && !CITY_ADDRESS_RE2.test(options.localCity)) {
      throw new Error("invalid_ratchet_local_city");
    }
    const now = options.now ?? Date.now();
    if (!Number.isSafeInteger(now) || now < 0) throw new Error("invalid_ratchet_message_time");
    const pendingExpiresAt = options.pendingExpiresAt ?? now + MAX_PENDING_PLAINTEXT_AGE_MS;
    if (!Number.isSafeInteger(pendingExpiresAt) || pendingExpiresAt <= now || pendingExpiresAt - now > MAX_PENDING_PLAINTEXT_AGE_MS) throw new Error("invalid_ratchet_pending_expiry");
    return this.store.update((current) => {
      const state = requireInitialized(current);
      const persisted = state.sessions[scope];
      if (persisted) {
        pruneExpiredPending(persisted, now);
        if (persisted.seen.includes(messageId)) {
          return { state, result: { status: "duplicate" } };
        }
        const cached = persisted.pending[messageId];
        if (cached) {
          return { state, result: { status: "pending", plaintext: cached.plaintext } };
        }
        throw new Error("hybrid_establishment_after_session");
      }
      const prekey = state.hybridPrekeys[keyId];
      if (!prekey || prekey.publicKeyHash !== expectedPublicKeyHash || prekey.roadId !== roadId || prekey.revision !== revision) throw new Error("hybrid_prekey_road_mismatch");
      const wire = parseWireMessage(open2(prekey.seed, prekey.publicKey));
      if (wire.type !== 0) throw new Error("hybrid_establishment_prekey_message_required");
      const result = decryptWithState(
        state,
        roadId,
        messageId,
        wire,
        options,
        now,
        pendingExpiresAt
      );
      if (result.status !== "pending") throw new Error("hybrid_establishment_failed");
      delete state.hybridPrekeys[keyId];
      state.hybridPrekeyOutbox = state.hybridPrekeyOutbox.filter((id) => id !== keyId);
      return { state, result };
    });
  }
  async decrypt(roadId, messageId, message, options) {
    await ensureRatchetWasm();
    roadScope(roadId, options.revision ?? 1);
    requireMessageId(messageId);
    parseWireMessage(message);
    requirePeerDescriptor({
      deviceId: options.peerDeviceId,
      identityKey: options.peerIdentityKey,
      signingKey: options.peerSigningKey
    });
    if (options.localCity !== void 0 && !CITY_ADDRESS_RE2.test(options.localCity)) {
      throw new Error("invalid_ratchet_local_city");
    }
    const now = options.now ?? Date.now();
    if (!Number.isSafeInteger(now) || now < 0) {
      throw new Error("invalid_ratchet_message_time");
    }
    const pendingExpiresAt = options.pendingExpiresAt ?? now + MAX_PENDING_PLAINTEXT_AGE_MS;
    if (!Number.isSafeInteger(pendingExpiresAt) || pendingExpiresAt <= now || pendingExpiresAt - now > MAX_PENDING_PLAINTEXT_AGE_MS) throw new Error("invalid_ratchet_pending_expiry");
    return this.store.update((current) => {
      const state = requireInitialized(current);
      return {
        state,
        result: decryptWithState(
          state,
          roadId,
          messageId,
          message,
          options,
          now,
          pendingExpiresAt
        )
      };
    });
  }
  async commitInbound(roadId, messageId, revision = 1) {
    const scope = roadScope(roadId, revision);
    requireMessageId(messageId);
    return this.store.update((current) => {
      const state = requireInitialized(current);
      const session = state.sessions[scope];
      if (!session) throw new Error("ratchet_session_not_initialized");
      const now = Date.now();
      pruneExpiredPending(session, now);
      if (session.seen.includes(messageId)) return { state, result: false };
      if (!session.pending[messageId]) throw new Error("ratchet_message_not_pending");
      delete session.pending[messageId];
      rememberSeen(session, messageId);
      session.updatedAt = now;
      return { state, result: true };
    });
  }
  async forgetRoad(roadId) {
    requireRoadId(roadId);
    return this.store.update((current) => {
      const state = requireInitialized(current);
      const scopes = Object.keys(state.sessions).filter((scope) => scope.startsWith(`${roadId}:`));
      const revisions = new Set(scopes.map((scope) => Number(scope.slice(scope.lastIndexOf(":") + 1))));
      for (const capability of Object.values(state.inboundSealedCapabilities)) {
        if (capability.roadId === roadId) revisions.add(capability.revision);
      }
      for (const outbox of Object.values(state.sealedOutbox)) {
        if (outbox.roadId === roadId) revisions.add(outbox.revision);
      }
      for (const scope of Object.keys(state.outboundSealedCapabilities)) {
        if (scope.startsWith(`${roadId}:`)) revisions.add(Number(scope.slice(scope.lastIndexOf(":") + 1)));
      }
      for (const prekey of Object.values(state.hybridPrekeys)) {
        if (prekey.roadId === roadId && prekey.revision !== null) revisions.add(prekey.revision);
      }
      const removedHybrid = removeHybridRoadPrekeys(state, roadId);
      const existed = scopes.length > 0 || revisions.size > 0 || removedHybrid > 0;
      for (const scope of scopes) delete state.sessions[scope];
      for (const revision of revisions) removeSealedRoadState(state, roadId, revision);
      return { state, result: existed };
    });
  }
  async forgetRoadRevision(roadId, revision) {
    const scope = roadScope(roadId, revision);
    return this.store.update((current) => {
      const state = requireInitialized(current);
      const existed = Boolean(state.sessions[scope]);
      delete state.sessions[scope];
      const channels = removeSealedRoadState(state, roadId, revision);
      const removedHybrid = removeHybridRoadPrekeys(state, roadId, revision);
      return { state, result: existed || channels.length > 0 || removedHybrid > 0 };
    });
  }
  async reconcileCityRoads(localCity, activeRoads) {
    if (!CITY_ADDRESS_RE2.test(localCity) || !Array.isArray(activeRoads)) {
      throw new Error("invalid_ratchet_city_reconciliation");
    }
    const active = new Set(activeRoads.map((road) => roadScope(road.id, road.revision)));
    if (active.size !== activeRoads.length) throw new Error("invalid_ratchet_city_reconciliation");
    return this.store.update((current) => {
      const state = requireInitialized(current);
      let removed = 0;
      const now = Date.now();
      for (const [scope, session] of Object.entries(state.sessions)) {
        pruneExpiredPending(session, now);
        if (session.localCity === localCity && !active.has(scope)) {
          delete state.sessions[scope];
          const separator = scope.lastIndexOf(":");
          removeSealedRoadState(
            state,
            scope.slice(0, separator),
            Number(scope.slice(separator + 1))
          );
          removed += 1;
        }
      }
      for (const prekey of Object.values(state.hybridPrekeys)) {
        if (!prekey.roadId || prekey.revision === null || prekey.localCity !== localCity) continue;
        const scope = roadScope(prekey.roadId, prekey.revision);
        if (!active.has(scope)) removed += removeHybridRoadPrekeys(
          state,
          prekey.roadId,
          prekey.revision
        );
      }
      return { state, result: removed };
    });
  }
  async pruneExpiredPending(now = Date.now()) {
    if (!Number.isSafeInteger(now) || now < 0) throw new Error("invalid_ratchet_prune_time");
    return this.store.update((current) => {
      const state = requireInitialized(current);
      let removed = 0;
      for (const session of Object.values(state.sessions)) {
        removed += pruneExpiredPending(session, now);
      }
      return { state, result: removed };
    });
  }
  async hasSession(roadId, revision = 1, peer) {
    const scope = roadScope(roadId, revision);
    if (peer) requirePeerDescriptor(peer);
    return this.store.update((current) => {
      const state = requireInitialized(current);
      const pinned = peer ? state.peers[peer.deviceId] : null;
      if (peer && pinned && (pinned.identityKey !== peer.identityKey || pinned.signingKey !== peer.signingKey)) throw new Error("ratchet_peer_identity_changed");
      const session = state.sessions[scope];
      if (!session) return { state, result: false };
      if (peer && (session.peerDeviceId !== peer.deviceId || session.peerIdentityKey !== peer.identityKey || session.peerSigningKey !== peer.signingKey)) throw new Error("ratchet_peer_identity_changed");
      return { state, result: true };
    });
  }
  async verifyPeer(peer, verifiedAt = Date.now()) {
    requirePeerDescriptor(peer);
    if (!Number.isSafeInteger(verifiedAt) || verifiedAt < 0) {
      throw new Error("invalid_ratchet_verification_time");
    }
    return this.store.update((current) => {
      const state = requireInitialized(current);
      const pinned = state.peers[peer.deviceId];
      if (!pinned) throw new Error("ratchet_peer_not_seen");
      if (pinned.identityKey !== peer.identityKey || pinned.signingKey !== peer.signingKey) {
        throw new Error("ratchet_peer_identity_changed");
      }
      if (verifiedAt < pinned.firstSeenAt) throw new Error("invalid_ratchet_verification_time");
      pinned.verifiedAt = verifiedAt;
      return { state, result: true };
    });
  }
  async peerTrust(deviceId) {
    if (!UUID_RE2.test(deviceId)) throw new Error("invalid_ratchet_peer_device");
    return this.store.update((current) => {
      const state = requireInitialized(current);
      const peer = state.peers[deviceId];
      return { state, result: peer ? { ...peer } : null };
    });
  }
  async keyTransparencyState(deviceId) {
    if (!UUID_RE2.test(deviceId)) throw new Error("invalid_transparency_device");
    return this.store.update((current) => {
      const state = requireInitialized(current);
      const transparency = state.keyTransparency[deviceId];
      return {
        state,
        result: transparency ? { ...transparency, frontier: [...transparency.frontier] } : null
      };
    });
  }
  async commitKeyTransparencyState(deviceId, transparency) {
    if (!UUID_RE2.test(deviceId)) throw new Error("invalid_transparency_device");
    return this.store.update((current) => {
      const state = requireInitialized(current);
      const previous = state.keyTransparency[deviceId];
      if (previous && (transparency.treeSize < previous.treeSize || transparency.treeSize === previous.treeSize && (transparency.root !== previous.root || transparency.mapRoot !== previous.mapRoot))) throw new Error("key_transparency_state_regression");
      state.keyTransparency[deviceId] = {
        ...transparency,
        frontier: [...transparency.frontier]
      };
      return { state, result: true };
    });
  }
};
var generateRatchetMasterKey = () => crypto.getRandomValues(new Uint8Array(32));
var ratchetSafetyNumber = async (left, right) => {
  if (!UUID_RE2.test(left.deviceId) || !UUID_RE2.test(right.deviceId)) {
    throw new Error("invalid_safety_number_device");
  }
  if (!isBase64Key(left.identityKey) || !isBase64Key(right.identityKey) || !isBase64Key(left.signingKey) || !isBase64Key(right.signingKey)) {
    throw new Error("invalid_safety_number_key");
  }
  const participants = [left, right].sort((a, b) => a.deviceId.localeCompare(b.deviceId));
  const digest = new Uint8Array(await crypto.subtle.digest(
    "SHA-512",
    textEncoder.encode([
      "agents-city-safety-number/1",
      ...participants.flatMap((participant) => [
        participant.deviceId,
        participant.identityKey,
        participant.signingKey
      ])
    ].join("\n"))
  ));
  const digits = [...digest].map((byte) => byte.toString().padStart(3, "0")).join("").slice(0, 60);
  return digits.match(/.{1,5}/g)?.join(" ") ?? digits;
};

// packages/connect-client/src/device.ts
var generateDeviceKeys = async (options = {}) => {
  const signing = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"]
  );
  const encryption = await crypto.subtle.generateKey(
    { name: "X25519" },
    true,
    ["deriveBits"]
  );
  const ratchet = options.ratchet ?? new RoadRatchet(new EncryptedRatchetStateStore(
    new MemoryRatchetBackend(),
    generateRatchetMasterKey()
  ));
  const ratchetBundle = await ratchet.initialize();
  const hybridPrekeys = await ratchet.initializeHybridPrekeys(options.hybridPrekeyCount);
  return {
    signingPublicJwk: await crypto.subtle.exportKey("jwk", signing.publicKey),
    signingPrivateJwk: await crypto.subtle.exportKey("jwk", signing.privateKey),
    encryptionPublicJwk: await crypto.subtle.exportKey("jwk", encryption.publicKey),
    encryptionPrivateJwk: await crypto.subtle.exportKey("jwk", encryption.privateKey),
    ratchet,
    ratchetBundle,
    hybridPrekeys
  };
};
var signDeviceHybridPrekeys = async (keys, prekeys, keyVersion) => {
  if (!Array.isArray(prekeys) || prekeys.length < 1 || prekeys.length > 16 || !Number.isSafeInteger(keyVersion) || keyVersion < 1) throw new Error("invalid_hybrid_prekeys");
  const signingKeyId = await okpJwkThumbprint(keys.signingPublicJwk, "Ed25519");
  const signingKey = await importSigningKey(keys.signingPrivateJwk);
  return Promise.all(prekeys.map(async (prekey) => {
    const record = {
      protocol: HYBRID_PREKEY_PROTOCOL,
      suite: HYBRID_ESTABLISHMENT_SUITE,
      keyId: prekey.id,
      publicKey: prekey.publicKey,
      signingKeyId,
      keyVersion
    };
    const signature = new Uint8Array(await crypto.subtle.sign(
      "Ed25519",
      signingKey,
      textEncoder.encode(canonicalHybridPrekeyRecord(record))
    ));
    return { record, signature: bytesToBase64url2(signature) };
  }));
};
var signDeviceRatchetBundle = async (keys, publicBundle2 = keys.ratchetBundle) => {
  const bundle = {
    protocol: DEVICE_RATCHET_BUNDLE_PROTOCOL,
    ...publicBundle2
  };
  const signature = new Uint8Array(await crypto.subtle.sign(
    "Ed25519",
    await importSigningKey(keys.signingPrivateJwk),
    textEncoder.encode(canonicalDeviceRatchetBundle(bundle))
  ));
  return { bundle, signature: bytesToBase64url2(signature) };
};
var signDeviceKeyRecord = async (keys, record) => {
  const signature = new Uint8Array(await crypto.subtle.sign(
    "Ed25519",
    await importSigningKey(keys.signingPrivateJwk),
    textEncoder.encode(canonicalDeviceKeyRecord(record))
  ));
  return bytesToBase64url2(signature);
};
var importSigningKey = (jwk) => {
  if (jwk.kty !== "OKP" || jwk.crv !== "Ed25519" || typeof jwk.x !== "string" || typeof jwk.d !== "string") throw new Error("invalid_ed25519_private_key");
  return crypto.subtle.importKey("jwk", jwk, { name: "Ed25519" }, false, ["sign"]);
};
var signDeviceProof = async (identity, method, pathname, body = "", city = "") => {
  const fields = {
    method: method.toUpperCase(),
    pathname,
    deviceId: identity.deviceId,
    city,
    timestamp: Date.now(),
    nonce: randomBase64url(24),
    bodySha256: await sha256Hex(body)
  };
  const signature = new Uint8Array(await crypto.subtle.sign(
    "Ed25519",
    await importSigningKey(identity.signingPrivateJwk),
    textEncoder.encode(canonicalDeviceProof(fields))
  ));
  return {
    "x-agents-device": fields.deviceId,
    "x-agents-city": fields.city,
    "x-agents-timestamp": String(fields.timestamp),
    "x-agents-nonce": fields.nonce,
    "x-agents-body-sha256": fields.bodySha256,
    "x-agents-signature": bytesToBase64url2(signature)
  };
};
var ConnectApiError = class extends Error {
  constructor(code, status, retryAfterMs) {
    super(code);
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.name = "ConnectApiError";
  }
  code;
  status;
  retryAfterMs;
};
var MAX_API_RESPONSE_BYTES = 1048576;
var boundedResponseText = async (response) => {
  const declaredHeader = response.headers.get("content-length");
  if (declaredHeader !== null) {
    const declared = Number(declaredHeader);
    if (!Number.isSafeInteger(declared) || declared < 0 || declared > MAX_API_RESPONSE_BYTES) {
      throw new Error("connect_api_response_too_large");
    }
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_API_RESPONSE_BYTES) {
        await reader.cancel("response_too_large");
        throw new Error("connect_api_response_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
};
var apiJson = async (request, fetcher) => {
  const response = await fetcher(request);
  let value;
  try {
    value = JSON.parse(await boundedResponseText(response));
  } catch (error) {
    if (!response.ok) value = {};
    else {
      throw new ConnectApiError(
        error instanceof Error ? error.message : "invalid_connect_api_response",
        502,
        null
      );
    }
  }
  if (!response.ok) {
    const retryAfter = Number(response.headers.get("retry-after"));
    throw new ConnectApiError(
      value.error ?? `connect_api_${response.status}`,
      response.status,
      Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1e3 : null
    );
  }
  return value;
};
var beginDeviceAuthorization = async (controlPlaneUrl, machineName, platform, keys, fetcher = fetch) => {
  const ratchet = await signDeviceRatchetBundle(keys);
  const hybridPrekeys = await signDeviceHybridPrekeys(keys, keys.hybridPrekeys, 1);
  return apiJson(new Request(new URL("/api/device/authorize", controlPlaneUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      machine_name: machineName,
      platform,
      signing_public_jwk: keys.signingPublicJwk,
      encryption_public_jwk: keys.encryptionPublicJwk,
      ratchet_bundle: ratchet.bundle,
      ratchet_bundle_signature: ratchet.signature,
      hybrid_prekeys: hybridPrekeys
    })
  }), fetcher);
};
var claimDeviceAuthorization = async (controlPlaneUrl, deviceCode, keys, fetcher = fetch) => {
  const value = await apiJson(new Request(new URL("/api/device/token", controlPlaneUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ device_code: deviceCode })
  }), fetcher);
  const identity = {
    ...keys,
    deviceId: value.device_id,
    ownerPrefix: value.owner_prefix,
    relayUrl: value.bus_url,
    keyVersion: value.key_version
  };
  await identity.ratchet.confirmPublishedHybridPrekeys(
    keys.hybridPrekeys.map((prekey) => prekey.id)
  );
  if (value.transparency_status === "published") return identity;
  const record = value.transparency_record;
  if (!record || record.deviceId !== identity.deviceId || record.deviceVersion !== 1 || record.keyVersion !== identity.keyVersion || record.status !== "active" || record.authorization !== "device" || record.previousRecordHash !== null || record.signingPublicJwk.x !== keys.signingPublicJwk.x || record.encryptionPublicJwk.x !== keys.encryptionPublicJwk.x) throw new Error("invalid_transparency_record_proposal");
  const signature = await signDeviceKeyRecord(keys, record);
  const confirmed = await confirmDeviceTransparency(
    controlPlaneUrl,
    identity,
    signature,
    fetcher
  );
  if (confirmed.status !== "published") {
    throw new ConnectApiError("key_transparency_publication_pending", 503, 2e3);
  }
  return identity;
};
var confirmDeviceTransparency = async (controlPlaneUrl, identity, deviceSignature, fetcher = fetch) => {
  const body = JSON.stringify({ device_signature: deviceSignature });
  return apiJson(await signedDeviceRequest(controlPlaneUrl, identity, "/api/device/transparency", {
    method: "POST",
    body
  }), fetcher);
};
var abortableWait = (milliseconds, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(new Error("device_authorization_cancelled"));
  const timer = setTimeout(resolve, milliseconds);
  signal?.addEventListener("abort", () => {
    clearTimeout(timer);
    reject(new Error("device_authorization_cancelled"));
  }, { once: true });
});
var pollDeviceAuthorization = async (controlPlaneUrl, authorization, keys, options = {}) => {
  const deadline = Date.now() + authorization.expires_in * 1e3;
  const baseInterval = Math.max(1e3, authorization.interval * 1e3);
  while (Date.now() < deadline) {
    try {
      return await claimDeviceAuthorization(
        controlPlaneUrl,
        authorization.device_code,
        keys,
        options.fetcher ?? fetch
      );
    } catch (error) {
      if (!(error instanceof ConnectApiError) || ![
        "authorization_pending",
        "slow_down",
        "key_transparency_publication_pending"
      ].includes(error.code)) {
        throw error;
      }
      options.onPending?.();
      await abortableWait(Math.max(baseInterval, error.retryAfterMs ?? 0), options.signal);
    }
  }
  throw new Error("device_authorization_expired");
};
var signedDeviceRequest = async (controlPlaneUrl, identity, pathname, init = {}) => {
  const method = init.method ?? "GET";
  const body = init.body ?? "";
  const headers = await signDeviceProof(identity, method, pathname, body, init.city ?? "");
  return new Request(new URL(pathname, controlPlaneUrl), {
    method,
    headers: {
      ...headers,
      ...body ? { "content-type": "application/json" } : {}
    },
    ...body ? { body } : {}
  });
};
var replenishDevicePrekeys = async (controlPlaneUrl, identity, count = 32, fetcher = fetch) => {
  const publicBundle2 = await identity.ratchet.replenishOneTimeKeys(count);
  const hybridPublic = await identity.ratchet.replenishHybridPrekeys(Math.min(count, 16));
  const signed = await signDeviceRatchetBundle(identity, publicBundle2);
  const hybridPrekeys = await signDeviceHybridPrekeys(identity, hybridPublic, identity.keyVersion);
  const body = JSON.stringify({
    ratchet_bundle: signed.bundle,
    ratchet_bundle_signature: signed.signature,
    hybrid_prekeys: hybridPrekeys
  });
  const result = await apiJson(await signedDeviceRequest(controlPlaneUrl, identity, "/api/device/prekeys", {
    method: "POST",
    body
  }), fetcher);
  if (result.device_id !== identity.deviceId || result.published !== publicBundle2.oneTimeKeys.length || result.hybrid_published !== hybridPublic.length) {
    throw new Error("invalid_prekey_publish_response");
  }
  await identity.ratchet.confirmPublishedOneTimeKeys(
    publicBundle2.oneTimeKeys.map((prekey) => prekey.id)
  );
  await identity.ratchet.confirmPublishedHybridPrekeys(
    hybridPublic.map((prekey) => prekey.id)
  );
  return result;
};
var devicePrekeyStatus = async (controlPlaneUrl, identity, fetcher = fetch) => apiJson(await signedDeviceRequest(controlPlaneUrl, identity, "/api/device/prekeys"), fetcher);
var maintainDevicePrekeys = async (controlPlaneUrl, identity, fetcher = fetch) => {
  const status = await devicePrekeyStatus(controlPlaneUrl, identity, fetcher);
  if (status.device_id !== identity.deviceId) throw new Error("invalid_prekey_status_response");
  if (status.available >= status.replenish_below && status.hybrid_available >= status.hybrid_replenish_below) return { ...status, replenished: false };
  const replenished = await replenishDevicePrekeys(
    controlPlaneUrl,
    identity,
    status.replenish_count,
    fetcher
  );
  return {
    ...status,
    available: replenished.available,
    hybrid_available: replenished.hybrid_available,
    replenished: true
  };
};
var verifyPeerDeviceDirectory = async (controlPlaneUrl, identity, peer, trust, fetcher = fetch) => {
  const previous = await identity.ratchet.keyTransparencyState(peer.peerDeviceId);
  const pathname = "/api/device/key-directory";
  const headers = await signDeviceProof(identity, "GET", pathname);
  const url = new URL(pathname, controlPlaneUrl);
  url.searchParams.set("device_id", peer.peerDeviceId);
  url.searchParams.set("last_tree_size", String(previous?.treeSize ?? 0));
  const query = parseKeyTransparencyQuery(
    await apiJson(new Request(url, { headers }), fetcher)
  );
  const verified = await verifyKeyTransparencyQuery(
    peer.peerDeviceId,
    query,
    trust,
    previous
  );
  const record = verified.record;
  if (!record || record.status !== "active" || record.signingPublicJwk.x !== peer.peerSigningPublicJwk.x || record.encryptionPublicJwk.x !== peer.peerEncryptionPublicJwk.x || record.encryptionThumbprint !== peer.peerEncryptionKeyId || record.ratchetIdentityKey !== peer.peerRatchetIdentityKey || record.ratchetSigningKey !== peer.peerRatchetSigningKey || !record.establishmentSuites.includes(peer.establishmentSuite)) throw new Error("road_directory_key_transparency_mismatch");
  await identity.ratchet.commitKeyTransparencyState(peer.peerDeviceId, verified.state);
  return record;
};
var syncDeviceCities = async (controlPlaneUrl, identity, cities, fetcher = fetch) => {
  const body = JSON.stringify({ cities });
  return apiJson(await signedDeviceRequest(controlPlaneUrl, identity, "/api/device/cities", {
    method: "POST",
    body
  }), fetcher);
};
var listDeviceRoads = async (controlPlaneUrl, identity, fetcher = fetch) => apiJson(await signedDeviceRequest(controlPlaneUrl, identity, "/api/device/roads"), fetcher);
var signedRelayHeaders = (identity, city) => signDeviceProof(identity, "GET", "/v1/connect", "", city);

// packages/connect-client/src/road.ts
var MAX_ROAD_TEXT_BYTES = 12e3;
var MAX_ROAD_PLAINTEXT_BYTES = MAX_ROAD_TEXT_BYTES + 2048;
var HYBRID_INNER_PROTOCOL = "agents-city-hybrid-inner/1";
var importSigningPrivate = (jwk) => crypto.subtle.importKey(
  "jwk",
  jwk,
  { name: "Ed25519" },
  false,
  ["sign"]
);
var importSigningPublic = (jwk) => crypto.subtle.importKey(
  "jwk",
  jwk,
  { name: "Ed25519" },
  false,
  ["verify"]
);
var requireRoad = (road) => {
  if (!isCityAddress(road.localCity) || !isCityAddress(road.peerCity) || road.localCity === road.peerCity) {
    throw new Error("invalid_road_directory_entry");
  }
  if (!Number.isSafeInteger(road.revision) || road.revision < 1) {
    throw new Error("invalid_road_revision");
  }
};
var verifyPeerHybridPrekey = async (road) => {
  if (road.establishmentSuite !== HYBRID_ESTABLISHMENT_SUITE || road.ratchetRole !== "initiator" || !road.peerHybridPrekey || road.localHybridPrekeyId !== null) throw new Error("hybrid_establishment_not_available");
  const expectedSigningKeyId = await okpJwkThumbprint(road.peerSigningPublicJwk, "Ed25519");
  const { record, signature } = road.peerHybridPrekey;
  if (record.signingKeyId !== expectedSigningKeyId) {
    throw new Error("hybrid_prekey_signing_key_mismatch");
  }
  const valid = await crypto.subtle.verify(
    "Ed25519",
    await importSigningPublic(road.peerSigningPublicJwk),
    base64urlToBytes2(signature),
    textEncoder.encode(canonicalHybridPrekeyRecord(record))
  );
  if (!valid) throw new Error("invalid_hybrid_prekey_signature");
  return record;
};
var hybridTranscript = (envelope) => {
  if (envelope.payload.suite !== HYBRID_ESTABLISHMENT_SUITE) {
    throw new Error("hybrid_transcript_suite_mismatch");
  }
  const { ciphertext: _ciphertext, ...payload } = envelope.payload;
  return canonicalHybridTranscript({
    relayProtocol: envelope.protocol,
    id: envelope.id,
    requestId: envelope.requestId,
    roadId: envelope.roadId,
    roadRevision: envelope.roadRevision,
    from: envelope.from,
    to: envelope.to,
    createdAt: envelope.createdAt,
    expiresAt: envelope.expiresAt,
    senderDeviceId: envelope.senderDeviceId,
    senderKeyVersion: envelope.senderKeyVersion,
    payload
  });
};
var encodeHybridInner = (wire) => JSON.stringify({
  protocol: HYBRID_INNER_PROTOCOL,
  suite: SEALED_SUITE,
  type: wire.type,
  body: wire.body
});
var parseHybridInner = (plaintext) => {
  let candidate;
  try {
    candidate = JSON.parse(plaintext);
  } catch {
    throw new Error("invalid_hybrid_inner");
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("invalid_hybrid_inner");
  }
  const value = candidate;
  const keys = ["protocol", "suite", "type", "body"];
  if (Object.keys(value).length !== keys.length || !keys.every((key) => key in value) || value.protocol !== HYBRID_INNER_PROTOCOL || value.suite !== SEALED_SUITE || value.type !== 0 || typeof value.body !== "string" || value.body.length < 16 || value.body.length > 32e3) throw new Error("invalid_hybrid_inner");
  return { suite: SEALED_SUITE, type: 0, body: value.body };
};
var parsePendingHybridEnvelope = async (raw, identity, road) => {
  let candidate;
  try {
    candidate = JSON.parse(raw);
  } catch {
    throw new Error("invalid_hybrid_establishment_outbox");
  }
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("invalid_hybrid_establishment_outbox");
  }
  const unsigned = candidate;
  const parsed = parseRelayClientFrame(JSON.stringify({
    type: "send",
    envelope: {
      ...unsigned,
      signature: bytesToBase64url2(new Uint8Array(64))
    }
  }), Number(unsigned.createdAt));
  if (!parsed.ok || parsed.frame.type !== "send" || parsed.frame.envelope.payload.suite !== HYBRID_ESTABLISHMENT_SUITE || unsigned.roadId !== road.id || unsigned.roadRevision !== road.revision || unsigned.from !== road.localCity || unsigned.to !== road.peerCity || unsigned.senderDeviceId !== identity.deviceId || unsigned.senderKeyVersion !== identity.keyVersion || unsigned.payload.recipientKeyId !== road.peerEncryptionKeyId) throw new Error("hybrid_establishment_outbox_mismatch");
  const prekey = await verifyPeerHybridPrekey(road);
  if (unsigned.payload.suite !== HYBRID_ESTABLISHMENT_SUITE || unsigned.payload.pqPrekeyId !== prekey.keyId || unsigned.payload.pqPrekeyHash !== await hybridPrekeyHash(prekey.publicKey)) throw new Error("hybrid_establishment_outbox_mismatch");
  return unsigned;
};
var roadPlaintext = (envelope, kind, content) => {
  if (kind === "text") {
    if (typeof content !== "string" || !content.trim()) throw new Error("road_text_required");
    if (utf8Length(content) > MAX_ROAD_TEXT_BYTES) throw new Error("road_text_too_large");
  } else if (kind === "capability_grant") {
    if (!Array.isArray(content) || content.length < 1 || content.length > 32 || content.some((capability) => !parseSealedCapability(capability, envelope.createdAt)) || new Set(content.map((capability) => capability.token)).size !== content.length || new Set(content.map((capability) => capability.receiptTag)).size !== content.length || new Set(content.map((capability) => capability.channelTag)).size !== 1) throw new Error("invalid_sealed_capability_grant");
  } else if (content !== void 0) {
    throw new Error("unexpected_handshake_text");
  }
  const common = {
    protocol: ROAD_TEXT_PROTOCOL,
    kind,
    messageId: envelope.id,
    roadId: envelope.roadId,
    roadRevision: envelope.roadRevision,
    from: envelope.from,
    to: envelope.to,
    createdAt: envelope.createdAt,
    expiresAt: envelope.expiresAt,
    senderDeviceId: envelope.senderDeviceId,
    senderKeyVersion: envelope.senderKeyVersion
  };
  if (kind === "text") return JSON.stringify({ ...common, text: content });
  if (kind === "capability_grant") return JSON.stringify({
    ...common,
    grantProtocol: SEALED_CAPABILITY_GRANT_PROTOCOL,
    capabilities: content
  });
  return JSON.stringify(common);
};
var readRoadPlaintext = (plaintext, envelope) => {
  if (utf8Length(plaintext) > MAX_ROAD_PLAINTEXT_BYTES) throw new Error("road_text_too_large");
  let value;
  try {
    value = JSON.parse(plaintext);
  } catch {
    throw new Error("invalid_road_plaintext");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_road_plaintext");
  }
  const record = value;
  const expectedKeys = record.kind === "text" ? [
    "protocol",
    "kind",
    "messageId",
    "roadId",
    "roadRevision",
    "from",
    "to",
    "createdAt",
    "expiresAt",
    "senderDeviceId",
    "senderKeyVersion",
    "text"
  ] : record.kind === "capability_grant" ? [
    "protocol",
    "kind",
    "messageId",
    "roadId",
    "roadRevision",
    "from",
    "to",
    "createdAt",
    "expiresAt",
    "senderDeviceId",
    "senderKeyVersion",
    "grantProtocol",
    "capabilities"
  ] : [
    "protocol",
    "kind",
    "messageId",
    "roadId",
    "roadRevision",
    "from",
    "to",
    "createdAt",
    "expiresAt",
    "senderDeviceId",
    "senderKeyVersion"
  ];
  if (Object.keys(record).length !== expectedKeys.length || !expectedKeys.every((key) => key in record) || record.protocol !== ROAD_TEXT_PROTOCOL || !["handshake", "text", "capability_grant"].includes(String(record.kind)) || record.messageId !== envelope.id || record.roadId !== envelope.roadId || record.roadRevision !== envelope.roadRevision || record.from !== envelope.from || record.to !== envelope.to || record.createdAt !== envelope.createdAt || record.expiresAt !== envelope.expiresAt || record.senderDeviceId !== envelope.senderDeviceId || record.senderKeyVersion !== envelope.senderKeyVersion || record.kind === "text" && (typeof record.text !== "string" || !record.text.trim() || utf8Length(record.text) > MAX_ROAD_TEXT_BYTES) || record.kind === "capability_grant" && (record.grantProtocol !== SEALED_CAPABILITY_GRANT_PROTOCOL || !Array.isArray(record.capabilities) || record.capabilities.length < 1 || record.capabilities.length > 32 || record.capabilities.some((capability) => !parseSealedCapability(capability, envelope.createdAt)) || new Set(record.capabilities.map((capability) => capability.token)).size !== record.capabilities.length || new Set(record.capabilities.map((capability) => capability.receiptTag)).size !== record.capabilities.length || new Set(record.capabilities.map((capability) => capability.channelTag)).size !== 1)) throw new Error("road_plaintext_binding_failed");
  return record;
};
var createEnvelope = async (identity, road, kind, content, options = {}) => {
  requireRoad(road);
  const createdAt = options.now ?? Date.now();
  const lifetimeMs = options.lifetimeMs ?? MAX_MESSAGE_LIFETIME_MS;
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
    throw new Error("invalid_message_time");
  }
  if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs < 1 || lifetimeMs > MAX_MESSAGE_LIFETIME_MS) {
    throw new Error("invalid_message_lifetime");
  }
  const expiresAt = createdAt + lifetimeMs;
  if (!Number.isSafeInteger(expiresAt)) throw new Error("invalid_message_time");
  const signingKey = await importSigningPrivate(identity.signingPrivateJwk);
  const messageId = options.messageId ?? crypto.randomUUID();
  if (!UUID_RE.test(messageId)) throw new Error("invalid_message_id");
  const common = {
    protocol: RELAY_PROTOCOL,
    id: messageId,
    requestId: crypto.randomUUID(),
    roadId: road.id,
    roadRevision: road.revision,
    from: road.localCity,
    to: road.peerCity,
    createdAt,
    expiresAt,
    senderDeviceId: identity.deviceId,
    senderKeyVersion: identity.keyVersion
  };
  const peer = {
    deviceId: road.peerDeviceId,
    identityKey: road.peerRatchetIdentityKey,
    signingKey: road.peerRatchetSigningKey
  };
  const ratchetPeer = {
    peerDeviceId: road.peerDeviceId,
    peerIdentityKey: road.peerRatchetIdentityKey,
    peerSigningKey: road.peerRatchetSigningKey
  };
  const hasSession = await identity.ratchet.hasSession(road.id, road.revision, peer);
  let partial;
  const pendingHybrid = await identity.ratchet.pendingHybridEstablishment(
    road.id,
    road.revision,
    createdAt
  );
  if (pendingHybrid) {
    if (kind !== "handshake" || content !== void 0) {
      throw new Error("hybrid_establishment_pending");
    }
    partial = await parsePendingHybridEnvelope(pendingHybrid, identity, road);
  } else if (!hasSession && road.establishmentSuite === HYBRID_ESTABLISHMENT_SUITE) {
    if (road.ratchetRole !== "initiator" || !road.peerOneTimeKey) {
      throw new Error("hybrid_establishment_initiator_required");
    }
    const prekey = await verifyPeerHybridPrekey(road);
    await initializeHybridCrypto();
    const sender = await createHybridSenderSecret(road.peerEncryptionPublicJwk);
    const kemRandomness = randomKemEncapsulation();
    const nonce = randomHybridNonce();
    try {
      const pqPrekeyHash = await hybridPrekeyHash(prekey.publicKey);
      const hybridPartial = {
        ...common,
        payload: {
          suite: HYBRID_ESTABLISHMENT_SUITE,
          recipientKeyId: road.peerEncryptionKeyId,
          messageType: 0,
          ciphertext: "",
          pqPrekeyId: prekey.keyId,
          pqPrekeyHash,
          ephemeralKey: sender.ephemeralKey,
          nonce: bytesToBase64url2(nonce)
        }
      };
      const plaintext = roadPlaintext(hybridPartial, kind, content);
      const unsignedEnvelope = await identity.ratchet.encryptHybridEstablishment(
        road.id,
        plaintext,
        {
          revision: road.revision,
          localCity: road.localCity,
          ...ratchetPeer,
          peerOneTimeKey: road.peerOneTimeKey,
          now: createdAt
        },
        (wire) => JSON.stringify({
          ...hybridPartial,
          payload: {
            ...hybridPartial.payload,
            ciphertext: sealHybridEstablishment(
              prekey.publicKey,
              sender.classicalSecret,
              hybridTranscript(hybridPartial),
              encodeHybridInner(wire),
              kemRandomness,
              nonce
            )
          }
        })
      );
      partial = await parsePendingHybridEnvelope(unsignedEnvelope, identity, road);
    } finally {
      wipeHybridSecret(sender.classicalSecret);
      wipeHybridSecret(kemRandomness);
      wipeHybridSecret(nonce);
    }
  } else {
    const classicalPartial = {
      ...common,
      payload: {
        suite: SEALED_SUITE,
        recipientKeyId: road.peerEncryptionKeyId,
        messageType: 0,
        ciphertext: ""
      }
    };
    const encrypted = await identity.ratchet.encrypt(
      road.id,
      roadPlaintext(classicalPartial, kind, content),
      {
        revision: road.revision,
        localCity: road.localCity,
        ...ratchetPeer,
        now: createdAt,
        ...!hasSession && road.ratchetRole === "initiator" && road.peerOneTimeKey ? { peerOneTimeKey: road.peerOneTimeKey } : {}
      }
    );
    classicalPartial.payload.messageType = encrypted.type;
    classicalPartial.payload.ciphertext = encrypted.body;
    if (standardBase64DecodedLength(encrypted.body) > MAX_CIPHERTEXT_BYTES) {
      throw new Error("road_ciphertext_too_large");
    }
    partial = classicalPartial;
  }
  const signature = new Uint8Array(await crypto.subtle.sign(
    "Ed25519",
    signingKey,
    textEncoder.encode(canonicalRelayEnvelope(partial))
  ));
  const envelope = { ...partial, signature: bytesToBase64url2(signature) };
  const parsed = parseRelayClientFrame(JSON.stringify({ type: "send", envelope }), createdAt);
  if (!parsed.ok) throw new Error(parsed.code);
  return envelope;
};
var createRoadEnvelope = (identity, road, text, options = {}) => createEnvelope(identity, road, "text", text, options);
var createRoadHandshakeEnvelope = (identity, road, options = {}) => createEnvelope(identity, road, "handshake", void 0, options);
var createRoadCapabilityGrantEnvelope = (identity, road, capabilities, options = {}) => createEnvelope(identity, road, "capability_grant", capabilities, options);
var roadSafetyNumber = async (identity, road) => {
  requireRoad(road);
  const local = await identity.ratchet.identity();
  return ratchetSafetyNumber(
    {
      deviceId: identity.deviceId,
      identityKey: local.identityKey,
      signingKey: local.signingKey
    },
    {
      deviceId: road.peerDeviceId,
      identityKey: road.peerRatchetIdentityKey,
      signingKey: road.peerRatchetSigningKey
    }
  );
};
var roadPeerTrust = async (identity, road) => {
  const safetyNumber = await roadSafetyNumber(identity, road);
  const trust = await identity.ratchet.peerTrust(road.peerDeviceId);
  return {
    safetyNumber,
    firstSeenAt: trust?.firstSeenAt ?? null,
    verifiedAt: trust?.verifiedAt ?? null,
    status: trust?.verifiedAt ? "verified" : "unverified"
  };
};
var verifyRoadSafetyNumber = async (identity, road, confirmedNumber) => {
  const expected = (await roadSafetyNumber(identity, road)).replaceAll(" ", "");
  const supplied = String(confirmedNumber).replace(/\s+/g, "");
  if (!/^\d{60}$/.test(supplied) || supplied !== expected) {
    throw new Error("road_safety_number_mismatch");
  }
  await identity.ratchet.verifyPeer({
    deviceId: road.peerDeviceId,
    identityKey: road.peerRatchetIdentityKey,
    signingKey: road.peerRatchetSigningKey
  });
  return roadPeerTrust(identity, road);
};
var openRoadEnvelope = async (identity, road, envelope, now = Date.now()) => {
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(envelope.createdAt) || envelope.createdAt > now + MAX_CLOCK_SKEW_MS || envelope.expiresAt <= now) throw new Error("invalid_envelope");
  const parsed = parseRelayClientFrame(
    JSON.stringify({ type: "send", envelope }),
    envelope.createdAt
  );
  if (!parsed.ok) throw new Error(parsed.code);
  if (envelope.roadId !== road.id || envelope.roadRevision !== road.revision || envelope.from !== road.peerCity || envelope.to !== road.localCity || envelope.senderDeviceId !== road.peerDeviceId || envelope.payload.recipientKeyId !== road.localEncryptionKeyId) throw new Error("road_envelope_mismatch");
  const valid = await crypto.subtle.verify(
    "Ed25519",
    await importSigningPublic(road.peerSigningPublicJwk),
    base64urlToBytes2(envelope.signature),
    textEncoder.encode(canonicalRelayEnvelope(envelope))
  );
  if (!valid) throw new Error("invalid_road_signature");
  const decryptOptions = {
    revision: road.revision,
    localCity: road.localCity,
    peerDeviceId: road.peerDeviceId,
    peerIdentityKey: road.peerRatchetIdentityKey,
    peerSigningKey: road.peerRatchetSigningKey,
    now,
    pendingExpiresAt: envelope.expiresAt
  };
  let opened;
  if (envelope.payload.suite === HYBRID_ESTABLISHMENT_SUITE) {
    if (road.establishmentSuite !== HYBRID_ESTABLISHMENT_SUITE || road.ratchetRole !== "responder" || !road.localHybridPrekeyId || road.peerHybridPrekey !== null || envelope.payload.pqPrekeyId !== road.localHybridPrekeyId) throw new Error("hybrid_establishment_road_mismatch");
    await initializeHybridCrypto();
    const classicalSecret = await deriveHybridRecipientSecret(
      identity.encryptionPrivateJwk,
      envelope.payload.ephemeralKey
    );
    const nonce = base64urlToBytes2(envelope.payload.nonce);
    try {
      opened = await identity.ratchet.decryptHybridEstablishment(
        road.id,
        envelope.id,
        envelope.payload.pqPrekeyId,
        envelope.payload.pqPrekeyHash,
        (seed) => parseHybridInner(openHybridEstablishment(
          seed,
          classicalSecret,
          hybridTranscript(envelope),
          envelope.payload.ciphertext,
          nonce
        )),
        decryptOptions
      );
    } finally {
      wipeHybridSecret(classicalSecret);
      wipeHybridSecret(nonce);
    }
  } else {
    opened = await identity.ratchet.decrypt(
      road.id,
      envelope.id,
      {
        suite: SEALED_SUITE,
        type: envelope.payload.messageType,
        body: envelope.payload.ciphertext
      },
      {
        ...decryptOptions,
        requireExistingSession: road.establishmentSuite === HYBRID_ESTABLISHMENT_SUITE
      }
    );
  }
  if (opened.status === "duplicate") return { status: "duplicate", messageId: envelope.id };
  const plaintext = readRoadPlaintext(opened.plaintext, envelope);
  if (plaintext.kind === "handshake") {
    return { status: "pending", kind: "handshake", messageId: envelope.id };
  }
  if (plaintext.kind === "capability_grant") {
    return {
      status: "pending",
      kind: "capability_grant",
      messageId: envelope.id,
      capabilities: plaintext.capabilities.map((capability) => ({ ...capability }))
    };
  }
  return { status: "pending", kind: "text", messageId: envelope.id, text: plaintext.text };
};
var SEALED_ROAD_MESSAGE_PROTOCOL = "agents-city-sealed-road-message/1";
var SEALED_PADDING_BUCKETS = [1024, 4096, 8192, 15872];
var paddedSealedPlaintext = (identity, road, capability, messageId, text, createdAt, expiresAt) => {
  if (typeof text !== "string" || !text.trim()) throw new Error("road_text_required");
  if (utf8Length(text) > MAX_ROAD_TEXT_BYTES) throw new Error("road_text_too_large");
  const plaintext = {
    protocol: SEALED_ROAD_MESSAGE_PROTOCOL,
    kind: "text",
    messageId,
    receiptTag: capability.receiptTag,
    roadId: road.id,
    roadRevision: road.revision,
    from: road.localCity,
    to: road.peerCity,
    createdAt,
    expiresAt,
    senderDeviceId: identity.deviceId,
    senderKeyVersion: identity.keyVersion,
    text,
    padding: ""
  };
  const baseSize = utf8Length(JSON.stringify(plaintext));
  const target = SEALED_PADDING_BUCKETS.find((bucket) => bucket >= baseSize);
  if (!target) throw new Error("road_text_too_large");
  const paddingLength = target - baseSize;
  plaintext.padding = randomBase64url(Math.ceil(paddingLength * 3 / 4) + 1).slice(0, paddingLength);
  const encoded = JSON.stringify(plaintext);
  if (utf8Length(encoded) !== target) throw new Error("sealed_padding_failed");
  return encoded;
};
var createSealedRoadSubmission = async (identity, road, text, options = {}) => {
  requireRoad(road);
  const createdAt = options.now ?? Date.now();
  const lifetimeMs = options.lifetimeMs ?? MAX_MESSAGE_LIFETIME_MS;
  if (!Number.isSafeInteger(createdAt) || createdAt < 0 || !Number.isSafeInteger(lifetimeMs) || lifetimeMs < 1 || lifetimeMs > MAX_MESSAGE_LIFETIME_MS) throw new Error("invalid_message_time");
  const expiresAt = createdAt + lifetimeMs;
  const requestBinding = options.messageId === void 0 ? void 0 : await sha256Base64url2(JSON.stringify({
    protocol: "agents-city-sealed-request-binding/1",
    roadId: road.id,
    roadRevision: road.revision,
    text
  }));
  return identity.ratchet.createSealedSubmission(
    road.id,
    road.revision,
    (capability, messageId) => paddedSealedPlaintext(
      identity,
      road,
      capability,
      messageId,
      text,
      createdAt,
      expiresAt
    ),
    {
      localCity: road.localCity,
      peerDeviceId: road.peerDeviceId,
      peerIdentityKey: road.peerRatchetIdentityKey,
      peerSigningKey: road.peerRatchetSigningKey,
      now: createdAt,
      messageId: options.messageId,
      requestBinding
    }
  );
};
var readSealedRoadPlaintext = (plaintext, road, delivery, now) => {
  if (utf8Length(plaintext) > MAX_RATCHET_PLAINTEXT_BYTES) {
    throw new Error("road_text_too_large");
  }
  let value;
  try {
    value = JSON.parse(plaintext);
  } catch {
    throw new Error("invalid_sealed_road_plaintext");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_sealed_road_plaintext");
  }
  const record = value;
  const keys = [
    "protocol",
    "kind",
    "messageId",
    "receiptTag",
    "roadId",
    "roadRevision",
    "from",
    "to",
    "createdAt",
    "expiresAt",
    "senderDeviceId",
    "senderKeyVersion",
    "text",
    "padding"
  ];
  if (Object.keys(record).length !== keys.length || !keys.every((key) => key in record) || record.protocol !== SEALED_ROAD_MESSAGE_PROTOCOL || record.kind !== "text" || record.messageId !== delivery.id || record.receiptTag !== delivery.receiptTag || record.roadId !== road.id || record.roadRevision !== road.revision || record.from !== road.peerCity || record.to !== road.localCity || record.senderDeviceId !== road.peerDeviceId || !Number.isSafeInteger(record.senderKeyVersion) || Number(record.senderKeyVersion) < 1 || !Number.isSafeInteger(record.createdAt) || Number(record.createdAt) > now + MAX_CLOCK_SKEW_MS || !Number.isSafeInteger(record.expiresAt) || Number(record.expiresAt) <= now || Number(record.expiresAt) - Number(record.createdAt) > MAX_MESSAGE_LIFETIME_MS || typeof record.text !== "string" || !record.text.trim() || utf8Length(record.text) > MAX_ROAD_TEXT_BYTES || typeof record.padding !== "string" || !/^[A-Za-z0-9_-]*$/.test(record.padding)) throw new Error("sealed_road_plaintext_binding_failed");
  return record;
};
var openSealedRoadDelivery = async (identity, road, candidate, now = Date.now()) => {
  const delivery = parseSealedDelivery(candidate, now);
  if (!delivery) throw new Error("invalid_sealed_delivery");
  const capability = await identity.ratchet.resolveInboundSealedCapability(
    delivery.receiptTag,
    delivery.id,
    now
  );
  if (capability.roadId !== road.id || capability.revision !== road.revision) {
    throw new Error("sealed_capability_road_mismatch");
  }
  if (capability.duplicate) return { status: "duplicate", messageId: delivery.id };
  const opened = await identity.ratchet.decrypt(
    road.id,
    delivery.id,
    {
      suite: SEALED_SUITE,
      type: delivery.payload.messageType,
      body: delivery.payload.ciphertext
    },
    {
      revision: road.revision,
      localCity: road.localCity,
      peerDeviceId: road.peerDeviceId,
      peerIdentityKey: road.peerRatchetIdentityKey,
      peerSigningKey: road.peerRatchetSigningKey,
      now,
      pendingExpiresAt: delivery.expiresAt,
      requireExistingSession: true
    }
  );
  if (opened.status === "duplicate") return { status: "duplicate", messageId: delivery.id };
  const plaintext = readSealedRoadPlaintext(opened.plaintext, road, delivery, now);
  return { status: "pending", kind: "text", messageId: delivery.id, text: plaintext.text };
};

// packages/connect-client/src/sealed-client.ts
var MAX_RESPONSE_BYTES = 16384;
var boundedText = async (response, maximumBytes) => {
  const declared = response.headers.get("content-length");
  if (declared !== null) {
    const size = Number(declared);
    if (!Number.isSafeInteger(size) || size < 0 || size > maximumBytes) {
      throw new Error("sealed_response_too_large");
    }
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel("response_too_large");
        throw new Error("sealed_response_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
};
var SealedSenderError = class extends Error {
  constructor(code, status, retryAfterMs) {
    super(code);
    this.code = code;
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.name = "SealedSenderError";
  }
  code;
  status;
  retryAfterMs;
};
var sealedSenderEndpoint = (relayUrl) => {
  const url = new URL(relayUrl);
  if (url.protocol === "wss:") url.protocol = "https:";
  else if (url.protocol === "ws:") url.protocol = "http:";
  else if (!["https:", "http:"].includes(url.protocol)) throw new Error("invalid_relay_url");
  url.pathname = "/v1/sealed";
  url.search = "";
  url.hash = "";
  return url.toString();
};
var submitSealedMessage = async (endpoint, candidate, fetcher = fetch) => {
  const submission = parseSealedSubmission(candidate);
  if (!submission) throw new Error("invalid_sealed_submission");
  const body = JSON.stringify(submission);
  if (new TextEncoder().encode(body).byteLength > MAX_SEALED_SUBMISSION_BYTES) {
    throw new Error("sealed_submission_too_large");
  }
  const response = await fetcher(new Request(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body
  }));
  let value;
  try {
    value = JSON.parse(await boundedText(response, MAX_RESPONSE_BYTES));
  } catch (error) {
    if (response.ok) throw new SealedSenderError(
      error instanceof Error ? error.message : "invalid_sealed_response",
      502,
      null
    );
    value = {};
  }
  const record = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  if (!response.ok) {
    const retryAfter = Number(response.headers.get("retry-after"));
    throw new SealedSenderError(
      typeof record.error === "string" ? record.error : `sealed_sender_${response.status}`,
      response.status,
      Number.isFinite(retryAfter) && retryAfter >= 0 ? retryAfter * 1e3 : null
    );
  }
  if (Object.keys(record).length !== 2 || !["queued", "duplicate"].includes(String(record.status)) || record.message_id !== submission.id) throw new SealedSenderError("invalid_sealed_response", 502, null);
  return {
    messageId: submission.id,
    status: record.status
  };
};

// packages/connect-client/src/relay-session.ts
var ManagedRelaySession = class {
  constructor(identity, city, transport, options) {
    this.identity = identity;
    this.city = city;
    this.transport = transport;
    this.options = options;
    const relayHostname = new URL(identity.relayUrl).hostname;
    const nonProductionRelay = relayHostname === "localhost" || relayHostname === "127.0.0.1" || relayHostname === "[::1]" || relayHostname.endsWith(".localhost") || relayHostname.endsWith(".test") || relayHostname.endsWith(".invalid");
    if (!options.keyTransparency && (!options.developmentUnsafeSkipKeyTransparency || !nonProductionRelay)) throw new Error("key_transparency_required");
    if (options.keyTransparency && options.developmentUnsafeSkipKeyTransparency) {
      throw new Error("ambiguous_key_transparency_configuration");
    }
    this.requestTimeoutMs = options.requestTimeoutMs ?? 1e4;
    this.readyTimeoutMs = options.readyTimeoutMs ?? 1e4;
    this.readyPromise = new Promise((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.readyTimer = setTimeout(
      () => this.failReady(new Error("relay_directory_timeout")),
      this.readyTimeoutMs
    );
    transport.onMessage((raw) => {
      this.inboundTail = this.inboundTail.then(() => this.handleRaw(raw)).catch((error) => this.securityFailure(error));
    });
    transport.onClose(
      () => this.closeState(new Error("relay_connection_closed"))
    );
  }
  identity;
  city;
  transport;
  options;
  roadsById = /* @__PURE__ */ new Map();
  snapshots = /* @__PURE__ */ new Map();
  latestUpdates = /* @__PURE__ */ new Map();
  pending = /* @__PURE__ */ new Map();
  pendingCapabilities = /* @__PURE__ */ new Map();
  secureRoads = /* @__PURE__ */ new Set();
  roadSecurityWaiters = /* @__PURE__ */ new Map();
  roadBootstraps = /* @__PURE__ */ new Map();
  sealedBootstraps = /* @__PURE__ */ new Map();
  sealedWaiters = /* @__PURE__ */ new Map();
  requestTimeoutMs;
  readyTimeoutMs;
  expectedRoads = null;
  welcomed = false;
  directoryReady = false;
  readyResolve;
  readyReject;
  readyTimer;
  readyPromise;
  inboundTail = Promise.resolve();
  sealedRefreshTimer = null;
  closed = false;
  ready() {
    return this.readyPromise;
  }
  roads() {
    return [...this.roadsById.values()].map((road) => ({ ...road }));
  }
  async sendRoadText(roadId, text, options = {}) {
    if (this.closed) throw new Error("relay_connection_closed");
    await this.ready();
    const road = this.roadsById.get(roadId);
    if (!road) throw new Error("road_not_available");
    await this.ensureRoadSecure(road);
    if (this.options.sealedSender) {
      const requested = options.messageId ? (await this.identity.ratchet.pendingSealedSubmissions(road.id, road.revision)).find((entry) => entry.submission.id === options.messageId) : void 0;
      await this.flushSealedOutbox(road, options.messageId);
      if (!requested) await this.ensureSealedReady(road);
      const { submission } = await createSealedRoadSubmission(this.identity, road, text, {
        messageId: options.messageId
      });
      try {
        const result2 = await this.submitSealedWithRetry(submission);
        await options.onAccepted?.(result2);
        await this.identity.ratchet.confirmSealedSubmission(submission.id);
        return result2;
      } catch (error) {
        throw error;
      }
    }
    const envelope = await createRoadEnvelope(this.identity, road, text, {
      messageId: options.messageId
    });
    const result = await this.sendEnvelope(envelope);
    await options.onAccepted?.(result);
    return result;
  }
  async sendEnvelope(envelope) {
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(envelope.requestId);
        reject(new Error("relay_request_timeout"));
      }, this.requestTimeoutMs);
      this.pending.set(envelope.requestId, { resolve, reject, timer });
    });
    try {
      this.transport.send(JSON.stringify({ type: "send", envelope }));
    } catch (error) {
      this.rejectPending(
        envelope.requestId,
        error instanceof Error ? error : new Error("relay_send_failed")
      );
    }
    const accepted = await result;
    if (envelope.payload.suite === HYBRID_ESTABLISHMENT_SUITE) {
      await this.identity.ratchet.confirmHybridEstablishmentQueued(
        envelope.roadId,
        envelope.roadRevision,
        envelope.id
      );
    }
    return accepted;
  }
  capabilityRequest(frame) {
    const requestId = crypto.randomUUID();
    const expected = frame.type === "capability_register" ? "registered" : "revoked";
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCapabilities.delete(requestId);
        reject(new Error("capability_request_timeout"));
      }, this.requestTimeoutMs);
      this.pendingCapabilities.set(requestId, { expected, resolve, reject, timer });
    });
    try {
      this.transport.send(JSON.stringify({ ...frame, requestId }));
    } catch (error) {
      const pending = this.pendingCapabilities.get(requestId);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingCapabilities.delete(requestId);
        pending.reject(error instanceof Error ? error : new Error("capability_request_failed"));
      }
    }
    return result;
  }
  async primeSealedCapabilities(road) {
    if (!this.options.sealedSender || this.closed) return;
    const scope = this.roadScope(road);
    if (this.sealedBootstraps.has(scope)) return this.sealedBootstraps.get(scope);
    const bootstrap = (async () => {
      const pending = await this.identity.ratchet.ensureInboundSealedCapabilities(
        road.id,
        road.revision
      );
      if (pending.length) {
        await this.capabilityRequest({ type: "capability_register", capabilities: pending });
        await this.identity.ratchet.confirmInboundSealedCapabilities(
          pending.map((capability) => capability.receiptTag)
        );
      }
      const capabilities = await this.identity.ratchet.unsharedInboundSealedCapabilities(
        road.id,
        road.revision
      );
      if (capabilities.length) {
        const envelope = await createRoadCapabilityGrantEnvelope(
          this.identity,
          road,
          capabilities
        );
        await this.sendEnvelope(envelope);
        await this.identity.ratchet.confirmSharedInboundSealedCapabilities(
          capabilities.map((capability) => capability.receiptTag)
        );
      }
    })();
    this.sealedBootstraps.set(scope, bootstrap);
    try {
      await bootstrap;
    } catch (error) {
      this.sealedBootstraps.delete(scope);
      throw error;
    }
  }
  markSealedReady(road) {
    const scope = this.roadScope(road);
    const waiters = this.sealedWaiters.get(scope);
    if (!waiters) return;
    this.sealedWaiters.delete(scope);
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
  }
  async ensureSealedReady(road) {
    if (await this.identity.ratchet.outboundSealedCapabilityCount(road.id, road.revision)) return;
    void this.primeSealedCapabilities(road).catch((error) => this.options.onLocalError?.(
      error instanceof Error ? error : new Error("sealed_capability_bootstrap_failed")
    ));
    return new Promise((resolve, reject) => {
      const scope = this.roadScope(road);
      const waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const current = this.sealedWaiters.get(scope);
          current?.delete(waiter);
          if (!current?.size) this.sealedWaiters.delete(scope);
          reject(new Error("sealed_capability_peer_not_ready"));
        }, this.readyTimeoutMs)
      };
      const waiters = this.sealedWaiters.get(scope) ?? /* @__PURE__ */ new Set();
      waiters.add(waiter);
      this.sealedWaiters.set(scope, waiters);
    });
  }
  async submitSealedWithRetry(submission) {
    const configured = this.options.sealedSender;
    if (!configured) throw new Error("sealed_sender_not_configured");
    const endpoint = configured.endpointUrl ?? sealedSenderEndpoint(this.identity.relayUrl);
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await submitSealedMessage(endpoint, submission, configured.fetcher ?? fetch);
      } catch (error) {
        lastError = error;
        if (error instanceof SealedSenderError && error.status !== 429 && error.status < 500) throw error;
        if (attempt < 2) {
          const delay2 = error instanceof SealedSenderError ? Math.min(500, error.retryAfterMs ?? 100 * (attempt + 1)) : 100 * (attempt + 1);
          await new Promise((resolve) => setTimeout(resolve, delay2));
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error("sealed_sender_unavailable");
  }
  async flushSealedOutbox(road, excludedMessageId) {
    const pending = await this.identity.ratchet.pendingSealedSubmissions(road.id, road.revision);
    for (const entry of pending) {
      if (entry.submission.id === excludedMessageId) continue;
      if (entry.requestBinding !== null) continue;
      try {
        await this.submitSealedWithRetry(entry.submission);
        await this.identity.ratchet.confirmSealedSubmission(entry.submission.id);
      } catch (error) {
        throw error;
      }
    }
  }
  scheduleSealedRefresh() {
    if (!this.options.sealedSender || this.closed || this.sealedRefreshTimer) return;
    this.sealedRefreshTimer = setTimeout(() => {
      this.sealedRefreshTimer = null;
      for (const road of this.roadsById.values()) {
        this.sealedBootstraps.delete(this.roadScope(road));
        void this.primeSealedCapabilities(road).catch((error) => this.options.onLocalError?.(
          error instanceof Error ? error : new Error("sealed_capability_refresh_failed")
        ));
      }
      this.scheduleSealedRefresh();
    }, SEALED_CAPABILITY_REFRESH_INTERVAL_MS);
  }
  ping() {
    if (this.closed) throw new Error("relay_connection_closed");
    this.transport.send(JSON.stringify({ type: "ping", at: Date.now() }));
  }
  close() {
    if (!this.closed) this.transport.close(1e3, "client closing");
    this.closeState(new Error("relay_connection_closed"));
  }
  async handleRaw(raw) {
    const parsed = parseRelayServerFrame(raw);
    if (!parsed.ok) throw new Error(parsed.code);
    const frame = parsed.frame;
    if (frame.type === "welcome") {
      if (frame.protocol !== RELAY_PROTOCOL || frame.city !== this.city || frame.deviceId !== this.identity.deviceId || this.expectedRoads !== null && frame.roadCount !== this.expectedRoads)
        throw new Error("relay_identity_mismatch");
      if (this.welcomed) return;
      this.welcomed = true;
      this.expectedRoads = frame.roadCount;
      return;
    }
    if (frame.type === "road_directory") return this.applyDirectory(frame);
    if (frame.type === "road_update") {
      const previous = this.latestUpdates.get(frame.roadId);
      if (previous && (frame.revision < previous.revision || frame.revision === previous.revision && previous.status === "revoked"))
        return;
      if (frame.status === "active" && frame.road?.localCity !== this.city) {
        throw new Error("road_update_city_mismatch");
      }
      this.latestUpdates.set(frame.roadId, frame);
      if (this.directoryReady) await this.applyRoadUpdate(frame);
      return;
    }
    if (frame.type === "result") {
      const request = this.pending.get(frame.requestId);
      if (!request) return;
      clearTimeout(request.timer);
      this.pending.delete(frame.requestId);
      request.resolve({ messageId: frame.messageId, status: frame.status });
      return;
    }
    if (frame.type === "capability_result") {
      const request = this.pendingCapabilities.get(frame.requestId);
      if (!request) return;
      if (request.expected !== frame.status) throw new Error("capability_result_mismatch");
      clearTimeout(request.timer);
      this.pendingCapabilities.delete(frame.requestId);
      request.resolve(frame.affected);
      return;
    }
    if (frame.type === "error") {
      if (frame.requestId && this.pendingCapabilities.has(frame.requestId)) {
        const request = this.pendingCapabilities.get(frame.requestId);
        clearTimeout(request.timer);
        this.pendingCapabilities.delete(frame.requestId);
        request.reject(new Error(frame.code));
      } else if (frame.requestId)
        this.rejectPending(frame.requestId, new Error(frame.code));
      else throw new Error(frame.code);
      return;
    }
    if (frame.type === "message") return this.acceptMessages([frame]);
    if (frame.type === "message_batch")
      return this.acceptMessages(frame.messages);
    if (frame.type === "sealed_message") return this.acceptSealedMessages([frame]);
    if (frame.type === "sealed_message_batch") {
      return this.acceptSealedMessages(frame.messages);
    }
  }
  async applyDirectory(frame) {
    if (this.expectedRoads === null)
      throw new Error("road_directory_before_welcome");
    if (this.directoryReady) throw new Error("unexpected_road_directory");
    let snapshot = this.snapshots.get(frame.snapshotId);
    if (!snapshot) {
      snapshot = { pages: frame.pages, chunks: /* @__PURE__ */ new Map() };
      this.snapshots.clear();
      this.snapshots.set(frame.snapshotId, snapshot);
    }
    if (snapshot.pages !== frame.pages || snapshot.chunks.has(frame.page)) {
      throw new Error("invalid_road_directory_sequence");
    }
    if (frame.page !== snapshot.chunks.size + 1) {
      throw new Error("invalid_road_directory_sequence");
    }
    snapshot.chunks.set(frame.page, frame.roads);
    if (snapshot.chunks.size !== snapshot.pages) {
      try {
        this.transport.send(JSON.stringify({
          type: "directory_next",
          snapshotId: frame.snapshotId,
          page: frame.page + 1
        }));
      } catch {
        const error = new Error("relay_directory_request_failed");
        this.transport.close(1013, "relay directory unavailable");
        this.closeState(error);
      }
      return;
    }
    const roads = [];
    for (let page = 1; page <= snapshot.pages; page += 1) {
      const chunk = snapshot.chunks.get(page);
      if (!chunk) throw new Error("incomplete_road_directory");
      roads.push(...chunk);
    }
    if (roads.length !== this.expectedRoads || new Set(roads.map((road) => road.id)).size !== roads.length) {
      throw new Error("road_directory_count_mismatch");
    }
    if (roads.some((road) => road.localCity !== this.city))
      throw new Error("road_directory_city_mismatch");
    if (this.options.keyTransparency) {
      const verified = /* @__PURE__ */ new Map();
      for (const road of roads) {
        let operation = verified.get(road.peerDeviceId);
        if (!operation) {
          operation = verifyPeerDeviceDirectory(
            this.options.keyTransparency.controlPlaneUrl,
            this.identity,
            road,
            this.options.keyTransparency.trust,
            this.options.keyTransparency.fetcher ?? fetch
          );
          verified.set(road.peerDeviceId, operation);
        }
        await operation;
      }
    }
    for (const road of roads) await this.bindRoadEstablishment(road);
    this.roadsById.clear();
    for (const road of roads) this.roadsById.set(road.id, road);
    for (const update of this.latestUpdates.values())
      await this.applyRoadUpdate(update);
    await this.identity.ratchet.reconcileCityRoads(
      this.city,
      [...this.roadsById.values()].map((road) => ({ id: road.id, revision: road.revision }))
    );
    this.snapshots.clear();
    this.directoryReady = true;
    clearTimeout(this.readyTimer);
    this.readyResolve();
    for (const road of this.roadsById.values()) this.primeRoadSecurity(road);
  }
  async applyRoadUpdate(frame) {
    const current = this.roadsById.get(frame.roadId);
    if (frame.status === "revoked") {
      if (!current || frame.revision >= current.revision) {
        if (current) this.clearRoadSecurity(current, new Error("road_revoked"));
        this.roadsById.delete(frame.roadId);
        if (current) {
          if (this.options.sealedSender) {
            try {
              const channels = await this.identity.ratchet.revokeSealedRoad(
                current.id,
                current.revision
              );
              await Promise.all(channels.map((channelTag) => this.capabilityRequest({
                type: "capability_revoke",
                channelTag
              })));
            } catch (error) {
              this.options.onLocalError?.(
                error instanceof Error ? error : new Error("sealed_capability_revocation_failed")
              );
            }
          }
          void this.identity.ratchet.forgetRoadRevision(current.id, current.revision).catch((error) => this.options.onLocalError?.(
            error instanceof Error ? error : new Error("ratchet_state_cleanup_failed")
          ));
        }
      }
      return;
    }
    if (!frame.road || frame.road.localCity !== this.city)
      throw new Error("road_update_city_mismatch");
    if (this.options.keyTransparency) {
      await verifyPeerDeviceDirectory(
        this.options.keyTransparency.controlPlaneUrl,
        this.identity,
        frame.road,
        this.options.keyTransparency.trust,
        this.options.keyTransparency.fetcher ?? fetch
      );
    }
    await this.bindRoadEstablishment(frame.road);
    if (!current || frame.revision >= current.revision) {
      if (current && frame.revision > current.revision) {
        this.clearRoadSecurity(current, new Error("road_revision_changed"));
        if (this.options.sealedSender) {
          try {
            const channels = await this.identity.ratchet.revokeSealedRoad(
              current.id,
              current.revision
            );
            await Promise.all(channels.map((channelTag) => this.capabilityRequest({
              type: "capability_revoke",
              channelTag
            })));
          } catch (error) {
            this.options.onLocalError?.(
              error instanceof Error ? error : new Error("sealed_capability_revocation_failed")
            );
          }
        }
        void this.identity.ratchet.forgetRoadRevision(current.id, current.revision).catch((error) => this.options.onLocalError?.(
          error instanceof Error ? error : new Error("ratchet_state_cleanup_failed")
        ));
      }
      this.roadsById.set(frame.roadId, frame.road);
    }
  }
  roadScope(road) {
    return `${road.id}:${road.revision}`;
  }
  async bindRoadEstablishment(road) {
    if (road.establishmentSuite === HYBRID_ESTABLISHMENT_SUITE && road.ratchetRole === "responder") {
      if (!road.localHybridPrekeyId) throw new Error("hybrid_prekey_assignment_missing");
      if (await this.identity.ratchet.hasSession(road.id, road.revision, {
        deviceId: road.peerDeviceId,
        identityKey: road.peerRatchetIdentityKey,
        signingKey: road.peerRatchetSigningKey
      })) return;
      await this.identity.ratchet.bindHybridPrekeyToRoad(
        road.localHybridPrekeyId,
        road.id,
        road.revision,
        road.localCity
      );
    }
  }
  markRoadSecure(road) {
    const scope = this.roadScope(road);
    const current = this.roadsById.get(road.id);
    if (!current || current.revision !== road.revision) return;
    this.secureRoads.add(scope);
    if (this.options.sealedSender) {
      void this.primeSealedCapabilities(road).catch((error) => this.options.onLocalError?.(
        error instanceof Error ? error : new Error("sealed_capability_bootstrap_failed")
      ));
      this.scheduleSealedRefresh();
    }
    const waiters = this.roadSecurityWaiters.get(scope);
    if (!waiters) return;
    this.roadSecurityWaiters.delete(scope);
    for (const waiter of waiters) {
      clearTimeout(waiter.timer);
      waiter.resolve();
    }
  }
  clearRoadSecurity(road, error) {
    const scope = this.roadScope(road);
    this.secureRoads.delete(scope);
    this.roadBootstraps.delete(scope);
    this.sealedBootstraps.delete(scope);
    const waiters = this.roadSecurityWaiters.get(scope);
    if (waiters) {
      this.roadSecurityWaiters.delete(scope);
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    }
    const sealedWaiters = this.sealedWaiters.get(scope);
    if (sealedWaiters) {
      this.sealedWaiters.delete(scope);
      for (const waiter of sealedWaiters) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    }
  }
  primeRoadSecurity(road) {
    const scope = this.roadScope(road);
    if (this.roadBootstraps.has(scope)) return;
    const bootstrap = (async () => {
      const hasSession = await this.identity.ratchet.hasSession(
        road.id,
        road.revision,
        {
          deviceId: road.peerDeviceId,
          identityKey: road.peerRatchetIdentityKey,
          signingKey: road.peerRatchetSigningKey
        }
      );
      const pending = await this.identity.ratchet.pendingHybridEstablishment(
        road.id,
        road.revision
      );
      if (hasSession && !pending) {
        this.markRoadSecure(road);
        return;
      }
      if (road.ratchetRole !== "initiator") return;
      const handshake = await createRoadHandshakeEnvelope(this.identity, road);
      await this.sendEnvelope(handshake);
      this.markRoadSecure(road);
    })();
    this.roadBootstraps.set(scope, bootstrap);
    void bootstrap.catch((value) => {
      this.roadBootstraps.delete(scope);
      this.options.onLocalError?.(
        value instanceof Error ? value : new Error("ratchet_handshake_failed")
      );
    });
  }
  async ensureRoadSecure(road) {
    const scope = this.roadScope(road);
    this.primeRoadSecurity(road);
    const bootstrap = this.roadBootstraps.get(scope);
    if (bootstrap) await bootstrap;
    if (this.secureRoads.has(scope)) return;
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const current = this.roadSecurityWaiters.get(scope);
          current?.delete(waiter);
          if (!current?.size) this.roadSecurityWaiters.delete(scope);
          reject(new Error("ratchet_peer_not_ready"));
        }, this.readyTimeoutMs)
      };
      const waiters = this.roadSecurityWaiters.get(scope) ?? /* @__PURE__ */ new Set();
      waiters.add(waiter);
      this.roadSecurityWaiters.set(scope, waiters);
    });
  }
  async acceptMessages(messages) {
    const accepted = [];
    for (const message of messages) {
      const road = this.roadsById.get(message.envelope.roadId);
      if (!road) throw new Error("message_without_active_road");
      const opened = await openRoadEnvelope(
        this.identity,
        road,
        message.envelope
      );
      this.markRoadSecure(road);
      if (opened.status === "duplicate") {
        accepted.push(opened.messageId);
        continue;
      }
      if (opened.kind === "handshake") {
        await this.identity.ratchet.commitInbound(
          road.id,
          opened.messageId,
          road.revision
        );
        accepted.push(opened.messageId);
        continue;
      }
      if (opened.kind === "capability_grant") {
        if (this.options.sealedSender) {
          const usable = opened.capabilities.filter((capability) => capability.expiresAt > Date.now() + 3e4);
          if (usable.length) {
            await this.identity.ratchet.acceptOutboundSealedCapabilities(
              road.id,
              road.revision,
              usable
            );
            this.markSealedReady(road);
          }
        }
        await this.identity.ratchet.commitInbound(
          road.id,
          opened.messageId,
          road.revision
        );
        accepted.push(opened.messageId);
        continue;
      }
      try {
        await this.handoffText({
          trust: "untrusted_remote_text",
          roadId: road.id,
          messageId: opened.messageId,
          from: message.envelope.from,
          to: message.envelope.to,
          text: opened.text
        });
      } catch (value) {
        this.acknowledgeBatch(accepted);
        const error = value instanceof Error ? value : new Error("local_road_handoff_failed");
        this.options.onLocalError?.(error);
        this.transport.close(1013, "local Road inbox unavailable");
        this.closeState(error);
        return;
      }
      await this.identity.ratchet.commitInbound(
        road.id,
        opened.messageId,
        road.revision
      );
      accepted.push(opened.messageId);
    }
    this.acknowledgeBatch(accepted);
  }
  async acceptSealedMessages(messages) {
    if (!this.options.sealedSender) throw new Error("unexpected_sealed_delivery");
    const accepted = [];
    for (const message of messages) {
      const resolved = await this.identity.ratchet.resolveInboundSealedCapability(
        message.delivery.receiptTag,
        message.delivery.id
      );
      const road = this.roadsById.get(resolved.roadId);
      if (!road || road.revision !== resolved.revision) {
        throw new Error("sealed_message_without_active_road");
      }
      const opened = await openSealedRoadDelivery(
        this.identity,
        road,
        message.delivery
      );
      this.markRoadSecure(road);
      if (opened.status === "duplicate") {
        await this.identity.ratchet.commitInboundSealedCapability(
          message.delivery.receiptTag,
          opened.messageId
        );
        accepted.push(opened.messageId);
        continue;
      }
      try {
        await this.handoffText({
          trust: "untrusted_remote_text",
          roadId: road.id,
          messageId: opened.messageId,
          from: road.peerCity,
          to: road.localCity,
          text: opened.text
        });
      } catch (value) {
        this.acknowledgeBatch(accepted);
        const error = value instanceof Error ? value : new Error("local_road_handoff_failed");
        this.options.onLocalError?.(error);
        this.transport.close(1013, "local Road inbox unavailable");
        this.closeState(error);
        return;
      }
      await this.identity.ratchet.commitInbound(
        road.id,
        opened.messageId,
        road.revision
      );
      await this.identity.ratchet.commitInboundSealedCapability(
        message.delivery.receiptTag,
        opened.messageId
      );
      accepted.push(opened.messageId);
      this.sealedBootstraps.delete(this.roadScope(road));
      void this.primeSealedCapabilities(road).catch((error) => this.options.onLocalError?.(
        error instanceof Error ? error : new Error("sealed_capability_replenishment_failed")
      ));
    }
    this.acknowledgeBatch(accepted);
  }
  async handoffText(message) {
    const receipt = await this.options.onText(message);
    if (!receipt || receipt.messageId !== message.messageId || !["inserted", "duplicate"].includes(receipt.status) || Object.keys(receipt).length !== 2) throw new Error("invalid_local_road_handoff_receipt");
  }
  acknowledgeBatch(messageIds) {
    if (!messageIds.length) return;
    this.transport.send(JSON.stringify({ type: "ack_batch", messageIds }));
  }
  rejectPending(requestId, error) {
    const request = this.pending.get(requestId);
    if (!request) return;
    clearTimeout(request.timer);
    this.pending.delete(requestId);
    request.reject(error);
  }
  securityFailure(value) {
    const error = value instanceof Error ? value : new Error("invalid_relay_frame");
    this.options.onSecurityError?.(error);
    this.transport.close(1008, "invalid relay frame");
    this.closeState(error);
  }
  failReady(error) {
    clearTimeout(this.readyTimer);
    this.readyReject(error);
  }
  closeState(error) {
    if (this.closed) return;
    this.closed = true;
    if (this.sealedRefreshTimer) clearTimeout(this.sealedRefreshTimer);
    this.sealedRefreshTimer = null;
    this.failReady(error);
    for (const requestId of [...this.pending.keys()])
      this.rejectPending(requestId, error);
    for (const [requestId, request] of this.pendingCapabilities) {
      clearTimeout(request.timer);
      this.pendingCapabilities.delete(requestId);
      request.reject(error);
    }
    for (const [scope, waiters] of this.roadSecurityWaiters) {
      this.roadSecurityWaiters.delete(scope);
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    }
    for (const [scope, waiters] of this.sealedWaiters) {
      this.sealedWaiters.delete(scope);
      for (const waiter of waiters) {
        clearTimeout(waiter.timer);
        waiter.reject(error);
      }
    }
  }
};

// packages/connect-client/src/node-persistence.ts
import { AsyncEntry } from "@napi-rs/keyring";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile
} from "node:fs/promises";
import { isAbsolute, join } from "node:path";

// packages/connect-client/src/keyring-secret.ts
var KEY_BYTES = 32;
var copyAndWipeKeyringSecret = (value) => {
  if (value === void 0 || value === null) return null;
  const bytes = value instanceof Uint8Array ? [...value] : Array.isArray(value) ? value : null;
  try {
    if (!bytes || bytes.length !== KEY_BYTES || bytes.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255)) throw new Error("invalid_ratchet_keyring_secret");
    return Uint8Array.from(bytes);
  } finally {
    if (value instanceof Uint8Array || Array.isArray(value)) value.fill(0);
  }
};

// packages/connect-client/src/node-persistence.ts
var RECORD_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
var LOCK_NAME = ".ratchet-state.lock";
var DEVICE_LOCK_NAME = ".device-vault.lock";
var MASTER_KEY_LOCK_NAME = ".device-master-key.lock";
var LOCK_TIMEOUT_MS = 1e4;
var LOCK_STALE_MS = 5 * 6e4;
var DEVICE_RECORD = "device-identity";
var LEGACY_DEVICE_RECORD_PROTOCOL = "agents-city-node-device/1";
var DEVICE_RECORD_PROTOCOL = "agents-city-node-device/2";
var ENCRYPTED_DEVICE_PROTOCOL = "agents-city-node-device-encrypted/1";
var UUID_RE3 = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
var OWNER_RE = /^[a-z0-9][a-z0-9_-]{0,31}$/;
var STANDARD_BASE64_KEY_RE = /^[A-Za-z0-9+/]+={0,2}$/;
var POSIX_PERMISSIONS = process.platform !== "win32";
var missing = (error) => error instanceof Error && "code" in error && error.code === "ENOENT";
var delay = (milliseconds) => new Promise((resolve) => {
  setTimeout(resolve, milliseconds);
});
var validateDirectory = (directory) => {
  if (typeof directory !== "string" || !isAbsolute(directory) || directory.includes("\0")) {
    throw new Error("invalid_ratchet_state_directory");
  }
  return directory;
};
var ensurePrivateDirectory = async (directory) => {
  await mkdir(directory, { recursive: true, mode: 448 });
  const metadata = await lstat(directory);
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new Error("unsafe_ratchet_state_directory");
  }
  if (POSIX_PERMISSIONS) await chmod(directory, 448);
};
var recordPath = (directory, key) => {
  if (!RECORD_RE.test(key)) throw new Error("invalid_ratchet_state_record");
  return join(directory, `${key}.json`);
};
var FileRatchetBackend = class {
  directory;
  constructor(directory) {
    this.directory = validateDirectory(directory);
  }
  async read(key) {
    await ensurePrivateDirectory(this.directory);
    const path = recordPath(this.directory, key);
    try {
      const metadata = await lstat(path);
      if (!metadata.isFile() || metadata.isSymbolicLink() || POSIX_PERMISSIONS && (metadata.mode & 63) !== 0) {
        throw new Error("unsafe_ratchet_state_record");
      }
      return await readFile(path, "utf8");
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  }
  async write(key, value) {
    if (typeof value !== "string" || value.length > 4e6) {
      throw new Error("invalid_ratchet_state_record");
    }
    await ensurePrivateDirectory(this.directory);
    const path = recordPath(this.directory, key);
    try {
      const metadata = await lstat(path);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        throw new Error("unsafe_ratchet_state_record");
      }
    } catch (error) {
      if (!missing(error)) throw error;
    }
    const temporary = join(this.directory, `.${key}.${crypto.randomUUID()}.tmp`);
    try {
      await writeFile(temporary, value, { encoding: "utf8", flag: "wx", mode: 384 });
      const handle = await open(temporary, "r");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, path);
      if (POSIX_PERMISSIONS) {
        await chmod(path, 384);
        const directoryHandle = await open(this.directory, "r");
        try {
          await directoryHandle.sync();
        } finally {
          await directoryHandle.close();
        }
      }
    } catch (error) {
      await unlink(temporary).catch(() => void 0);
      throw error;
    }
  }
  async remove(key) {
    await ensurePrivateDirectory(this.directory);
    try {
      await unlink(recordPath(this.directory, key));
    } catch (error) {
      if (!missing(error)) throw error;
    }
  }
};
var processIsAlive = (pid) => {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
};
var acquireFileLock = async (directory, lockName = LOCK_NAME) => {
  await ensurePrivateDirectory(directory);
  const path = join(directory, lockName);
  const token = crypto.randomUUID();
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    try {
      const handle = await open(path, "wx", 384);
      await handle.writeFile(JSON.stringify({ pid: process.pid, token, createdAt: Date.now() }));
      await handle.sync();
      return async () => {
        let owned = false;
        try {
          const value = JSON.parse(await readFile(path, "utf8"));
          owned = value.token === token;
        } catch (error) {
          if (!missing(error)) throw error;
        } finally {
          await handle.close();
        }
        if (owned) await unlink(path).catch((error) => {
          if (!missing(error)) throw error;
        });
      };
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
      try {
        const metadata = await lstat(path);
        const lock = JSON.parse(await readFile(path, "utf8"));
        const stale = typeof lock.createdAt !== "number" || Date.now() - lock.createdAt > LOCK_STALE_MS || !processIsAlive(Number(lock.pid));
        if (metadata.isFile() && !metadata.isSymbolicLink() && stale) {
          await unlink(path);
          continue;
        }
      } catch (inspectionError) {
        if (missing(inspectionError)) continue;
      }
      if (Date.now() >= deadline) throw new Error("ratchet_state_lock_timeout");
      await delay(25);
    }
  }
};
var FileLockedRatchetStore = class {
  constructor(directory, store) {
    this.directory = directory;
    this.store = store;
  }
  directory;
  store;
  async update(mutation) {
    const release = await acquireFileLock(this.directory);
    try {
      return await this.store.update(mutation);
    } finally {
      await release();
    }
  }
};
var validateKeyringName = (value) => {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:@/-]{0,127}$/.test(value)) {
    throw new Error("invalid_ratchet_keyring_name");
  }
  return value;
};
var loadOrCreateRatchetMasterKey = async (service, account) => {
  const entry = new AsyncEntry(validateKeyringName(service), validateKeyringName(account));
  let existing;
  try {
    existing = await entry.getSecret();
  } catch (error) {
    throw new Error("ratchet_os_keyring_unavailable", { cause: error });
  }
  const existingKey = copyAndWipeKeyringSecret(existing);
  if (existingKey) return existingKey;
  const generated = crypto.getRandomValues(new Uint8Array(32));
  try {
    await entry.setSecret(generated);
    generated.fill(0);
    const stored = copyAndWipeKeyringSecret(await entry.getSecret());
    if (!stored) throw new Error("ratchet_keyring_write_failed");
    return stored;
  } catch (error) {
    generated.fill(0);
    throw new Error("ratchet_os_keyring_unavailable", { cause: error });
  }
};
var createFileRoadRatchet = (directory, masterKey) => {
  const backend = new FileRatchetBackend(directory);
  const encrypted = new EncryptedRatchetStateStore(backend, masterKey);
  return new RoadRatchet(new FileLockedRatchetStore(backend.directory, encrypted));
};
var createOsProtectedRoadRatchet = async (options) => {
  const directory = validateDirectory(options.directory);
  const release = await acquireFileLock(directory, MASTER_KEY_LOCK_NAME);
  let masterKey;
  try {
    masterKey = await loadOrCreateRatchetMasterKey(
      options.service ?? "agents-city-private-roads",
      options.account
    );
  } finally {
    await release();
  }
  try {
    return createFileRoadRatchet(directory, masterKey);
  } finally {
    masterKey.fill(0);
  }
};
var isBase64Key2 = (value) => {
  if (typeof value !== "string" || !STANDARD_BASE64_KEY_RE.test(value)) return false;
  try {
    return atob(value.padEnd(Math.ceil(value.length / 4) * 4, "=")).length === 32;
  } catch {
    return false;
  }
};
var isOkpJwk = (value, curve, privateKey) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const jwk = value;
  try {
    if (jwk.kty !== "OKP" || jwk.crv !== curve || typeof jwk.x !== "string" || base64urlToBytes2(jwk.x).byteLength !== 32) return false;
    return privateKey ? typeof jwk.d === "string" && base64urlToBytes2(jwk.d).byteLength === 32 : jwk.d === void 0;
  } catch {
    return false;
  }
};
var isSecureRelayUrl = (value) => {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    if (url.username || url.password || url.search || url.hash) return false;
    if (url.protocol === "wss:") return true;
    return url.protocol === "ws:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  } catch {
    return false;
  }
};
var validateRatchetBundle = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const bundle = value;
  return isBase64Key2(bundle.identityKey) && isBase64Key2(bundle.signingKey) && Array.isArray(bundle.oneTimeKeys) && bundle.oneTimeKeys.length >= 1 && bundle.oneTimeKeys.length <= 50 && bundle.oneTimeKeys.every((prekey) => prekey && typeof prekey === "object" && /^[A-Za-z0-9_-]{1,64}$/.test(prekey.id) && isBase64Key2(prekey.key)) && new Set(bundle.oneTimeKeys.map((prekey) => prekey.id)).size === bundle.oneTimeKeys.length && new Set(bundle.oneTimeKeys.map((prekey) => prekey.key)).size === bundle.oneTimeKeys.length;
};
var isBase64urlSize = (value, bytes) => {
  if (typeof value !== "string") return false;
  try {
    return base64urlToBytes2(value).byteLength === bytes;
  } catch {
    return false;
  }
};
var validateHybridPrekeys = (value) => Array.isArray(value) && value.length >= 1 && value.length <= 16 && value.every((prekey) => prekey && typeof prekey === "object" && !Array.isArray(prekey) && /^[A-Za-z0-9_-]{16,64}$/.test(String(prekey.id ?? "")) && isBase64urlSize(prekey.publicKey, 1184)) && new Set(value.map((prekey) => prekey.id)).size === value.length && new Set(value.map((prekey) => prekey.publicKey)).size === value.length;
var validateDeviceRecord = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid_device_vault_record");
  }
  const record = value;
  const legacy = String(record.protocol) === LEGACY_DEVICE_RECORD_PROTOCOL;
  if (!legacy && record.protocol !== DEVICE_RECORD_PROTOCOL || !isOkpJwk(record.signingPublicJwk, "Ed25519", false) || !isOkpJwk(record.signingPrivateJwk, "Ed25519", true) || record.signingPublicJwk?.x !== record.signingPrivateJwk?.x || !isOkpJwk(record.encryptionPublicJwk, "X25519", false) || !isOkpJwk(record.encryptionPrivateJwk, "X25519", true) || record.encryptionPublicJwk?.x !== record.encryptionPrivateJwk?.x || !(record.ratchetBundle === null || validateRatchetBundle(record.ratchetBundle)) || !legacy && !(record.hybridPrekeys === null || validateHybridPrekeys(record.hybridPrekeys)) || !(record.assignment === null || record.assignment && typeof record.assignment === "object" && UUID_RE3.test(String(record.assignment.deviceId ?? "")) && OWNER_RE.test(String(record.assignment.ownerPrefix ?? "")) && isSecureRelayUrl(record.assignment.relayUrl) && Number.isSafeInteger(record.assignment.keyVersion) && Number(record.assignment.keyVersion) >= 1)) throw new Error("invalid_device_vault_record");
  return {
    ...record,
    protocol: DEVICE_RECORD_PROTOCOL,
    hybridPrekeys: legacy ? null : record.hybridPrekeys
  };
};
var generatePrimaryDeviceKeys = async () => {
  const signing = await crypto.subtle.generateKey(
    { name: "Ed25519" },
    true,
    ["sign", "verify"]
  );
  const encryption = await crypto.subtle.generateKey(
    { name: "X25519" },
    true,
    ["deriveBits"]
  );
  return {
    signingPublicJwk: await crypto.subtle.exportKey("jwk", signing.publicKey),
    signingPrivateJwk: await crypto.subtle.exportKey("jwk", signing.privateKey),
    encryptionPublicJwk: await crypto.subtle.exportKey("jwk", encryption.publicKey),
    encryptionPrivateJwk: await crypto.subtle.exportKey("jwk", encryption.privateKey)
  };
};
var sameDeviceKeys = (record, keys) => record.signingPublicJwk.x === keys.signingPublicJwk.x && record.signingPrivateJwk.d === keys.signingPrivateJwk.d && record.encryptionPublicJwk.x === keys.encryptionPublicJwk.x && record.encryptionPrivateJwk.d === keys.encryptionPrivateJwk.d && record.ratchetBundle?.identityKey === keys.ratchetBundle.identityKey && record.ratchetBundle?.signingKey === keys.ratchetBundle.signingKey && JSON.stringify(record.hybridPrekeys) === JSON.stringify(keys.hybridPrekeys);
var NodeDeviceVault = class {
  constructor(directory, masterKey) {
    this.directory = directory;
    this.directory = validateDirectory(directory);
    if (masterKey.byteLength !== 32) throw new Error("invalid_ratchet_master_key");
    const vaultKey = new Uint8Array(masterKey);
    this.keyPromise = crypto.subtle.importKey(
      "raw",
      toArrayBuffer(vaultKey),
      "AES-GCM",
      false,
      ["encrypt", "decrypt"]
    ).finally(() => vaultKey.fill(0));
    this.ratchet = createFileRoadRatchet(this.directory, masterKey);
  }
  directory;
  ratchet;
  keyPromise;
  async readRecord() {
    const raw = await new FileRatchetBackend(this.directory).read(DEVICE_RECORD);
    if (raw === null) return null;
    let encrypted;
    try {
      encrypted = JSON.parse(raw);
    } catch {
      throw new Error("invalid_encrypted_device_vault");
    }
    if (encrypted.protocol !== ENCRYPTED_DEVICE_PROTOCOL || typeof encrypted.nonce !== "string" || typeof encrypted.ciphertext !== "string") throw new Error("invalid_encrypted_device_vault");
    const nonce = base64urlToBytes2(encrypted.nonce);
    if (nonce.byteLength !== 12) throw new Error("invalid_encrypted_device_vault");
    try {
      const plaintext = await crypto.subtle.decrypt({
        name: "AES-GCM",
        iv: toArrayBuffer(nonce),
        additionalData: toArrayBuffer(textEncoder.encode(ENCRYPTED_DEVICE_PROTOCOL)),
        tagLength: 128
      }, await this.keyPromise, toArrayBuffer(base64urlToBytes2(encrypted.ciphertext)));
      return validateDeviceRecord(JSON.parse(textDecoder.decode(plaintext)));
    } catch (error) {
      if (error instanceof Error && error.message === "invalid_device_vault_record") throw error;
      throw new Error("device_vault_decryption_failed");
    }
  }
  async writeRecord(record) {
    const validated = validateDeviceRecord(record);
    const nonce = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({
      name: "AES-GCM",
      iv: toArrayBuffer(nonce),
      additionalData: toArrayBuffer(textEncoder.encode(ENCRYPTED_DEVICE_PROTOCOL)),
      tagLength: 128
    }, await this.keyPromise, toArrayBuffer(textEncoder.encode(JSON.stringify(validated))));
    const encrypted = {
      protocol: ENCRYPTED_DEVICE_PROTOCOL,
      nonce: bytesToBase64url2(nonce),
      ciphertext: bytesToBase64url2(new Uint8Array(ciphertext))
    };
    await new FileRatchetBackend(this.directory).write(DEVICE_RECORD, JSON.stringify(encrypted));
  }
  async verifyRatchet(record) {
    if (!record.ratchetBundle) throw new Error("device_vault_ratchet_not_initialized");
    const identity = await this.ratchet.identity();
    if (identity.identityKey !== record.ratchetBundle.identityKey || identity.signingKey !== record.ratchetBundle.signingKey) throw new Error("device_vault_ratchet_mismatch");
  }
  keys(record) {
    if (!record.ratchetBundle || !record.hybridPrekeys) {
      throw new Error("device_vault_ratchet_not_initialized");
    }
    return {
      signingPublicJwk: structuredClone(record.signingPublicJwk),
      signingPrivateJwk: structuredClone(record.signingPrivateJwk),
      encryptionPublicJwk: structuredClone(record.encryptionPublicJwk),
      encryptionPrivateJwk: structuredClone(record.encryptionPrivateJwk),
      ratchet: this.ratchet,
      ratchetBundle: structuredClone(record.ratchetBundle),
      hybridPrekeys: structuredClone(record.hybridPrekeys)
    };
  }
  async loadOrCreateKeys() {
    const release = await acquireFileLock(this.directory, DEVICE_LOCK_NAME);
    try {
      let record = await this.readRecord();
      if (!record) {
        record = {
          protocol: DEVICE_RECORD_PROTOCOL,
          ...await generatePrimaryDeviceKeys(),
          ratchetBundle: null,
          hybridPrekeys: null,
          assignment: null
        };
        await this.writeRecord(record);
      }
      if (!record.ratchetBundle) {
        let bundle;
        try {
          bundle = await this.ratchet.initialize();
        } catch (error) {
          if (!(error instanceof Error && error.message === "ratchet_identity_already_initialized")) {
            throw error;
          }
          bundle = await this.ratchet.replenishOneTimeKeys();
        }
        record.ratchetBundle = bundle;
        await this.writeRecord(record);
      }
      if (!record.hybridPrekeys) {
        try {
          record.hybridPrekeys = await this.ratchet.initializeHybridPrekeys();
        } catch (error) {
          if (!(error instanceof Error && error.message === "hybrid_prekeys_already_initialized")) {
            throw error;
          }
          record.hybridPrekeys = await this.ratchet.replenishHybridPrekeys();
        }
        await this.writeRecord(record);
      }
      await this.verifyRatchet(record);
      return this.keys(record);
    } finally {
      await release();
    }
  }
  async saveIdentity(identity) {
    const release = await acquireFileLock(this.directory, DEVICE_LOCK_NAME);
    try {
      const record = await this.readRecord();
      if (!record || !record.ratchetBundle || !sameDeviceKeys(record, identity)) {
        throw new Error("device_vault_identity_mismatch");
      }
      const assignment = {
        deviceId: identity.deviceId,
        ownerPrefix: identity.ownerPrefix,
        relayUrl: identity.relayUrl,
        keyVersion: identity.keyVersion
      };
      validateDeviceRecord({ ...record, assignment });
      if (record.assignment && JSON.stringify(record.assignment) !== JSON.stringify(assignment)) {
        throw new Error("device_vault_assignment_changed");
      }
      record.assignment = assignment;
      await this.writeRecord(record);
      return this.loadIdentityRecord(record);
    } finally {
      await release();
    }
  }
  loadIdentityRecord(record) {
    if (!record.assignment) return null;
    return { ...this.keys(record), ...structuredClone(record.assignment) };
  }
  async loadIdentity() {
    const release = await acquireFileLock(this.directory, DEVICE_LOCK_NAME);
    try {
      const record = await this.readRecord();
      if (!record) return null;
      await this.verifyRatchet(record);
      return this.loadIdentityRecord(record);
    } finally {
      await release();
    }
  }
};
var createFileDeviceVault = (directory, masterKey) => new NodeDeviceVault(directory, masterKey);
var createOsProtectedDeviceVault = async (options) => {
  const directory = validateDirectory(options.directory);
  const release = await acquireFileLock(directory, MASTER_KEY_LOCK_NAME);
  let masterKey;
  try {
    masterKey = await loadOrCreateRatchetMasterKey(
      options.service ?? "agents-city-private-device",
      options.account
    );
  } finally {
    await release();
  }
  try {
    return createFileDeviceVault(directory, masterKey);
  } finally {
    masterKey.fill(0);
  }
};
export {
  ConnectApiError,
  DEFAULT_HYBRID_ONE_TIME_KEYS,
  DEFAULT_ONE_TIME_KEYS,
  EncryptedRatchetStateStore,
  FileRatchetBackend,
  HYBRID_ESTABLISHMENT_SUITE,
  HYBRID_INNER_PROTOCOL,
  KEY_TRANSPARENCY_PROTOCOL,
  MAX_HYBRID_ONE_TIME_KEYS,
  MAX_PENDING_PLAINTEXTS,
  MAX_PENDING_PLAINTEXT_AGE_MS,
  MAX_RATCHET_PLAINTEXT_BYTES,
  MAX_SEEN_MESSAGE_IDS,
  ManagedRelaySession,
  MemoryRatchetBackend,
  NodeDeviceVault,
  RELAY_PROTOCOL,
  ROAD_RATCHET_PROTOCOL,
  ROAD_RATCHET_SUITE,
  RoadRatchet,
  SEALED_CAPABILITY_GRANT_PROTOCOL,
  SEALED_DELIVERY_PROTOCOL,
  SEALED_ROAD_MESSAGE_PROTOCOL,
  SEALED_SENDER_PROTOCOL,
  SEALED_SUITE,
  SealedSenderError,
  base64urlToBytes2 as base64urlToBytes,
  beginDeviceAuthorization,
  bytesToBase64url2 as bytesToBase64url,
  bytesToHex,
  canonicalRelayEnvelope,
  claimDeviceAuthorization,
  concatBytes2 as concatBytes,
  confirmDeviceTransparency,
  createFileDeviceVault,
  createFileRoadRatchet,
  createHybridSenderSecret,
  createOsProtectedDeviceVault,
  createOsProtectedRoadRatchet,
  createRoadCapabilityGrantEnvelope,
  createRoadEnvelope,
  createRoadHandshakeEnvelope,
  createSealedRoadSubmission,
  deriveHybridRecipientSecret,
  devicePrekeyStatus,
  generateDeviceKeys,
  generateMlKem768Prekey,
  generateRatchetMasterKey,
  hybridPrekeyHash,
  initializeHybridCrypto,
  listDeviceRoads,
  loadOrCreateRatchetMasterKey,
  maintainDevicePrekeys,
  openHybridEstablishment,
  openRoadEnvelope,
  openSealedRoadDelivery,
  parseRelayServerFrame,
  pollDeviceAuthorization,
  randomBase64url,
  randomHybridNonce,
  randomKemEncapsulation,
  ratchetSafetyNumber,
  replenishDevicePrekeys,
  roadPeerTrust,
  roadSafetyNumber,
  sealHybridEstablishment,
  sealedSenderEndpoint,
  sha256Base64url2 as sha256Base64url,
  sha256Bytes,
  sha256Hex,
  signDeviceHybridPrekeys,
  signDeviceKeyRecord,
  signDeviceProof,
  signDeviceRatchetBundle,
  signedDeviceRequest,
  signedRelayHeaders,
  submitSealedMessage,
  syncDeviceCities,
  textDecoder,
  textEncoder,
  toArrayBuffer,
  utf8Length,
  verifyKeyLogHead,
  verifyPeerDeviceDirectory,
  verifyRoadSafetyNumber,
  wipeHybridSecret
};
