/** @file WebGL vertex buffer cache keyed by RenderTree geometry array references. */

export type WebGLVertexBufferCache = {
  readonly prepareStaticVertices: (vertices: Float32Array) => void;
  readonly synchronizePreparedRenderTreeVertexArrays: (vertices: ReadonlySet<Float32Array>) => void;
  readonly bindVertices: (vertices: Float32Array) => void;
  readonly invalidateArrayBufferBinding: () => void;
  readonly resetFrameMetrics: () => void;
  readonly getFrameMetrics: () => WebGLVertexBufferCacheFrameMetrics;
  readonly dispose: () => void;
};

export type WebGLVertexBufferCacheFrameMetrics = {
  readonly dynamicBufferBindCount: number;
  readonly dynamicBufferUploadCount: number;
  readonly dynamicBufferUploadByteLength: number;
  readonly staticBufferBindCount: number;
  readonly staticBufferCreationCount: number;
  readonly staticBufferUploadByteLength: number;
  readonly staticBufferReleaseCount: number;
  readonly staticBufferCount: number;
};

type StaticVertexBufferEntry = {
  readonly buffer: WebGLBuffer;
  readonly hash: number;
  readonly renderTreeVertexArrays: Set<Float32Array>;
};

type MutableWebGLVertexBufferCacheFrameMetrics = {
  -readonly [Key in keyof Omit<WebGLVertexBufferCacheFrameMetrics, "staticBufferCount">]:
    WebGLVertexBufferCacheFrameMetrics[Key];
};

function requireWebGLBuffer(gl: WebGLRenderingContext, label: string): WebGLBuffer {
  const buffer = gl.createBuffer();
  if (buffer === null) {
    throw new Error(`WebGL vertex buffer cache failed to allocate ${label} buffer`);
  }
  return buffer;
}

function createEmptyFrameMetrics(): MutableWebGLVertexBufferCacheFrameMetrics {
  return {
    dynamicBufferBindCount: 0,
    dynamicBufferUploadCount: 0,
    dynamicBufferUploadByteLength: 0,
    staticBufferBindCount: 0,
    staticBufferCreationCount: 0,
    staticBufferUploadByteLength: 0,
    staticBufferReleaseCount: 0,
  };
}

function vertexBytes(vertices: Float32Array): Uint8Array {
  return new Uint8Array(vertices.buffer, vertices.byteOffset, vertices.byteLength);
}

function hashVertexBytes(vertices: Float32Array): number {
  return vertexBytes(vertices).reduce((hash, byte) => Math.imul(hash ^ byte, 16777619) >>> 0, 2166136261);
}

function equalVertexBytes(left: Float32Array, right: Float32Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  const rightBytes = vertexBytes(right);
  return vertexBytes(left).every((byte, index) => byte === rightBytes[index]);
}

function rememberStaticVertexBufferByHash(
  staticBuffersByHash: Map<number, readonly StaticVertexBufferEntry[]>,
  entry: StaticVertexBufferEntry,
): void {
  staticBuffersByHash.set(entry.hash, [...(staticBuffersByHash.get(entry.hash) ?? []), entry]);
}

function forgetStaticVertexBufferByHash(
  staticBuffersByHash: Map<number, readonly StaticVertexBufferEntry[]>,
  entry: StaticVertexBufferEntry,
): void {
  const bucket = staticBuffersByHash.get(entry.hash);
  if (bucket === undefined) {
    throw new Error("WebGL vertex buffer cache lost hash bucket for a static buffer entry");
  }
  const nextBucket = bucket.filter((candidate) => candidate !== entry);
  if (nextBucket.length === 0) {
    staticBuffersByHash.delete(entry.hash);
    return;
  }
  staticBuffersByHash.set(entry.hash, nextBucket);
}

function bindArrayBuffer(
  gl: WebGLRenderingContext,
  boundArrayBuffer: { value: WebGLBuffer | null },
  buffer: WebGLBuffer,
): boolean {
  if (boundArrayBuffer.value === buffer) {
    return false;
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  boundArrayBuffer.value = buffer;
  return true;
}

/** Create a per-context cache for stable geometry arrays produced from the RenderTree. */
export function createWebGLVertexBufferCache(gl: WebGLRenderingContext): WebGLVertexBufferCache {
  const dynamicBuffer = requireWebGLBuffer(gl, "dynamic");
  const dynamicUpload = { value: null as Float32Array | null };
  const seenVertices = new WeakSet<Float32Array>();
  const staticBuffers = new Map<Float32Array, StaticVertexBufferEntry>();
  const staticBuffersByHash = new Map<number, readonly StaticVertexBufferEntry[]>();
  const frameMetrics = createEmptyFrameMetrics();
  const boundArrayBuffer = { value: null as WebGLBuffer | null };

  function bindArrayBufferIfNeeded(buffer: WebGLBuffer): boolean {
    return bindArrayBuffer(gl, boundArrayBuffer, buffer);
  }

  function bindDynamicVertices(vertices: Float32Array): void {
    if (bindArrayBufferIfNeeded(dynamicBuffer)) {
      frameMetrics.dynamicBufferBindCount += 1;
    }
    if (dynamicUpload.value === vertices) {
      return;
    }
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.DYNAMIC_DRAW);
    dynamicUpload.value = vertices;
    frameMetrics.dynamicBufferUploadCount += 1;
    frameMetrics.dynamicBufferUploadByteLength += vertices.byteLength;
  }

  function rememberStaticVertexBufferRenderTreeVertexArray(vertices: Float32Array, entry: StaticVertexBufferEntry): void {
    if (staticBuffers.get(vertices) === entry) {
      return;
    }
    staticBuffers.set(vertices, entry);
    entry.renderTreeVertexArrays.add(vertices);
  }

  function promoteVertices(vertices: Float32Array): WebGLBuffer {
    const buffer = requireWebGLBuffer(gl, "static");
    const entry: StaticVertexBufferEntry = {
      buffer,
      hash: hashVertexBytes(vertices),
      renderTreeVertexArrays: new Set([vertices]),
    };
    if (bindArrayBufferIfNeeded(buffer)) {
      frameMetrics.staticBufferBindCount += 1;
    }
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    staticBuffers.set(vertices, entry);
    rememberStaticVertexBufferByHash(staticBuffersByHash, entry);
    frameMetrics.staticBufferCreationCount += 1;
    frameMetrics.staticBufferUploadByteLength += vertices.byteLength;
    return buffer;
  }

  function bindStaticBuffer(buffer: WebGLBuffer): void {
    if (bindArrayBufferIfNeeded(buffer)) {
      frameMetrics.staticBufferBindCount += 1;
    }
  }

  function findStaticBufferEntry(vertices: Float32Array): StaticVertexBufferEntry | undefined {
    const referenceEntry = staticBuffers.get(vertices);
    if (referenceEntry !== undefined) {
      return referenceEntry;
    }
    return staticBuffersByHash.get(hashVertexBytes(vertices))
      ?.find((entry) => {
        const representative = entry.renderTreeVertexArrays.values().next().value;
        if (representative === undefined) {
          throw new Error("WebGL vertex buffer cache has a static buffer entry without RenderTree vertex arrays");
        }
        return equalVertexBytes(representative, vertices);
      });
  }

  function releaseStaticVertexBuffer(entry: StaticVertexBufferEntry): void {
    gl.deleteBuffer(entry.buffer);
    if (boundArrayBuffer.value === entry.buffer) {
      boundArrayBuffer.value = null;
    }
    for (const vertices of entry.renderTreeVertexArrays) {
      staticBuffers.delete(vertices);
    }
    entry.renderTreeVertexArrays.clear();
    forgetStaticVertexBufferByHash(staticBuffersByHash, entry);
    frameMetrics.staticBufferReleaseCount += 1;
  }

  return {
    prepareStaticVertices(vertices) {
      const existing = findStaticBufferEntry(vertices);
      if (existing !== undefined) {
        rememberStaticVertexBufferRenderTreeVertexArray(vertices, existing);
        return;
      }
      promoteVertices(vertices);
    },

    synchronizePreparedRenderTreeVertexArrays(vertices) {
      for (const [renderTreeVertexArray, entry] of [...staticBuffers]) {
        if (vertices.has(renderTreeVertexArray)) {
          continue;
        }
        staticBuffers.delete(renderTreeVertexArray);
        entry.renderTreeVertexArrays.delete(renderTreeVertexArray);
      }
      for (const entry of new Set(Array.from(staticBuffersByHash.values()).flat())) {
        if (entry.renderTreeVertexArrays.size > 0) {
          continue;
        }
        releaseStaticVertexBuffer(entry);
      }
    },

    bindVertices(vertices) {
      const staticEntry = findStaticBufferEntry(vertices);
      if (staticEntry !== undefined) {
        rememberStaticVertexBufferRenderTreeVertexArray(vertices, staticEntry);
        bindStaticBuffer(staticEntry.buffer);
        return;
      }
      if (seenVertices.has(vertices)) {
        promoteVertices(vertices);
        return;
      }
      seenVertices.add(vertices);
      bindDynamicVertices(vertices);
    },

    invalidateArrayBufferBinding() {
      boundArrayBuffer.value = null;
    },

    resetFrameMetrics() {
      const empty = createEmptyFrameMetrics();
      frameMetrics.dynamicBufferBindCount = empty.dynamicBufferBindCount;
      frameMetrics.dynamicBufferUploadCount = empty.dynamicBufferUploadCount;
      frameMetrics.dynamicBufferUploadByteLength = empty.dynamicBufferUploadByteLength;
      frameMetrics.staticBufferBindCount = empty.staticBufferBindCount;
      frameMetrics.staticBufferCreationCount = empty.staticBufferCreationCount;
      frameMetrics.staticBufferUploadByteLength = empty.staticBufferUploadByteLength;
      frameMetrics.staticBufferReleaseCount = empty.staticBufferReleaseCount;
    },

    getFrameMetrics() {
      return {
        ...frameMetrics,
        staticBufferCount: new Set(staticBuffers.values()).size,
      };
    },

    dispose() {
      gl.deleteBuffer(dynamicBuffer);
      boundArrayBuffer.value = null;
      for (const entry of new Set(Array.from(staticBuffers.values()))) {
        gl.deleteBuffer(entry.buffer);
      }
      staticBuffers.clear();
      staticBuffersByHash.clear();
      dynamicUpload.value = null;
    },
  };
}
