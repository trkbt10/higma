/** @file WebGL vertex buffer cache tests. */

import { createWebGLVertexBufferCache } from "./vertex-buffer-cache";

type VertexBufferCalls = {
  readonly createBuffer: WebGLBuffer[];
  readonly bindBuffer: WebGLBuffer[];
  readonly bufferDataUsage: number[];
  readonly deleteBuffer: WebGLBuffer[];
};

type VertexBufferFakeGL = Pick<
  WebGLRenderingContext,
  "ARRAY_BUFFER" | "DYNAMIC_DRAW" | "STATIC_DRAW" | "createBuffer" | "bindBuffer" | "bufferData" | "deleteBuffer"
>;

function makeFakeGL(): { readonly gl: WebGLRenderingContext; readonly calls: VertexBufferCalls } {
  const calls: VertexBufferCalls = {
    createBuffer: [],
    bindBuffer: [],
    bufferDataUsage: [],
    deleteBuffer: [],
  };
  const gl: VertexBufferFakeGL = {
    ARRAY_BUFFER: 34962,
    DYNAMIC_DRAW: 35048,
    STATIC_DRAW: 35044,
    createBuffer: () => {
      const buffer = { id: calls.createBuffer.length } as WebGLBuffer;
      calls.createBuffer.push(buffer);
      return buffer;
    },
    bindBuffer: (_target, buffer) => {
      if (buffer === null) {
        throw new Error("vertex-buffer-cache spec does not bind null buffers");
      }
      calls.bindBuffer.push(buffer);
    },
    bufferData: (_target, _data, usage) => {
      calls.bufferDataUsage.push(usage);
    },
    deleteBuffer: (buffer) => {
      if (buffer !== null) {
        calls.deleteBuffer.push(buffer);
      }
    },
  };
  return { gl: gl as WebGLRenderingContext, calls };
}

describe("createWebGLVertexBufferCache", () => {
  it("uses the dynamic buffer for the first sighting of a vertex array", () => {
    const { gl, calls } = makeFakeGL();
    const cache = createWebGLVertexBufferCache(gl);
    const vertices = new Float32Array([0, 0, 1, 0, 1, 1]);

    cache.bindVertices(vertices);

    expect(calls.createBuffer.length).toBe(1);
    expect(calls.bindBuffer).toEqual([calls.createBuffer[0]]);
    expect(calls.bufferDataUsage).toEqual([gl.DYNAMIC_DRAW]);
    expect(cache.getFrameMetrics()).toMatchObject({
      dynamicBufferBindCount: 1,
      dynamicBufferUploadCount: 1,
      dynamicBufferUploadByteLength: vertices.byteLength,
      staticBufferBindCount: 0,
      staticBufferCreationCount: 0,
      staticBufferCount: 0,
    });
  });

  it("promotes a repeated vertex array to a static buffer and reuses it without reuploading", () => {
    const { gl, calls } = makeFakeGL();
    const cache = createWebGLVertexBufferCache(gl);
    const vertices = new Float32Array([0, 0, 1, 0, 1, 1]);

    cache.bindVertices(vertices);
    cache.bindVertices(vertices);
    cache.bindVertices(vertices);

    expect(calls.createBuffer.length).toBe(2);
    expect(calls.bindBuffer).toEqual([calls.createBuffer[0], calls.createBuffer[1]]);
    expect(calls.bufferDataUsage).toEqual([gl.DYNAMIC_DRAW, gl.STATIC_DRAW]);
    expect(cache.getFrameMetrics()).toMatchObject({
      dynamicBufferBindCount: 1,
      dynamicBufferUploadCount: 1,
      staticBufferBindCount: 1,
      staticBufferCreationCount: 1,
      staticBufferUploadByteLength: vertices.byteLength,
      staticBufferCount: 1,
    });
  });

  it("prepares a static buffer explicitly for geometry known to be stable", () => {
    const { gl, calls } = makeFakeGL();
    const cache = createWebGLVertexBufferCache(gl);
    const vertices = new Float32Array([0, 0, 1, 0, 1, 1]);

    cache.prepareStaticVertices(vertices);
    cache.bindVertices(vertices);

    expect(calls.createBuffer.length).toBe(2);
    expect(calls.bindBuffer).toEqual([calls.createBuffer[1]]);
    expect(calls.bufferDataUsage).toEqual([gl.STATIC_DRAW]);
    expect(cache.getFrameMetrics()).toMatchObject({
      dynamicBufferBindCount: 0,
      dynamicBufferUploadCount: 0,
      staticBufferBindCount: 1,
      staticBufferCreationCount: 1,
      staticBufferUploadByteLength: vertices.byteLength,
      staticBufferCount: 1,
    });
  });

  it("shares a static buffer for rebuilt equal vertices while tracking both RenderTree references", () => {
    const { gl, calls } = makeFakeGL();
    const cache = createWebGLVertexBufferCache(gl);
    const first = new Float32Array([0, 0, 1, 0, 1, 1]);
    const rebuilt = new Float32Array([0, 0, 1, 0, 1, 1]);

    cache.prepareStaticVertices(first);
    cache.prepareStaticVertices(rebuilt);
    cache.bindVertices(rebuilt);

    expect(calls.createBuffer.length).toBe(2);
    expect(calls.bindBuffer).toEqual([calls.createBuffer[1]]);
    expect(calls.bufferDataUsage).toEqual([gl.STATIC_DRAW]);
    expect(cache.getFrameMetrics()).toMatchObject({
      dynamicBufferBindCount: 0,
      dynamicBufferUploadCount: 0,
      staticBufferBindCount: 1,
      staticBufferCreationCount: 1,
      staticBufferUploadByteLength: first.byteLength,
      staticBufferCount: 1,
    });
  });

  it("does not promote one-off vertex arrays", () => {
    const { gl, calls } = makeFakeGL();
    const cache = createWebGLVertexBufferCache(gl);

    cache.bindVertices(new Float32Array([0, 0, 1, 0, 1, 1]));
    cache.bindVertices(new Float32Array([0, 0, 2, 0, 2, 2]));

    expect(calls.createBuffer.length).toBe(1);
    expect(calls.bufferDataUsage).toEqual([gl.DYNAMIC_DRAW, gl.DYNAMIC_DRAW]);
    expect(cache.getFrameMetrics()).toMatchObject({
      dynamicBufferBindCount: 1,
      dynamicBufferUploadCount: 2,
      staticBufferCreationCount: 0,
      staticBufferCount: 0,
    });
  });

  it("resets per-frame metrics without deleting cached buffers", () => {
    const { gl, calls } = makeFakeGL();
    const cache = createWebGLVertexBufferCache(gl);
    const vertices = new Float32Array([0, 0, 1, 0, 1, 1]);

    cache.prepareStaticVertices(vertices);
    cache.bindVertices(vertices);
    cache.resetFrameMetrics();
    cache.bindVertices(vertices);

    expect(calls.createBuffer.length).toBe(2);
    expect(cache.getFrameMetrics()).toMatchObject({
      dynamicBufferBindCount: 0,
      dynamicBufferUploadCount: 0,
      staticBufferBindCount: 0,
      staticBufferCreationCount: 0,
      staticBufferCount: 1,
    });
  });

  it("rebinding after raw WebGL invalidation is explicit", () => {
    const { gl, calls } = makeFakeGL();
    const cache = createWebGLVertexBufferCache(gl);
    const vertices = new Float32Array([0, 0, 1, 0, 1, 1]);

    cache.prepareStaticVertices(vertices);
    cache.bindVertices(vertices);
    cache.invalidateArrayBufferBinding();
    cache.bindVertices(vertices);

    expect(calls.bindBuffer).toEqual([calls.createBuffer[1], calls.createBuffer[1]]);
    expect(cache.getFrameMetrics()).toMatchObject({
      dynamicBufferBindCount: 0,
      dynamicBufferUploadCount: 0,
      staticBufferBindCount: 2,
      staticBufferCreationCount: 1,
      staticBufferCount: 1,
    });
  });

  it("does not release many small stable geometries by entry count alone", () => {
    const { gl, calls } = makeFakeGL();
    const cache = createWebGLVertexBufferCache(gl);
    const vertices = Array.from({ length: 5000 }, (_value, index) => new Float32Array([index, 0]));

    for (const vertexArray of vertices) {
      cache.prepareStaticVertices(vertexArray);
    }

    expect(calls.deleteBuffer).toEqual([]);
    expect(cache.getFrameMetrics()).toMatchObject({
      staticBufferCreationCount: 5000,
      staticBufferReleaseCount: 0,
      staticBufferCount: 5000,
    });
  });

  it("releases static buffers that are no longer referenced by the prepared RenderTree vertices", () => {
    const { gl, calls } = makeFakeGL();
    const cache = createWebGLVertexBufferCache(gl);
    const first = new Float32Array([0, 1]);
    const second = new Float32Array([2, 3]);
    const third = new Float32Array([4, 5]);

    cache.prepareStaticVertices(first);
    cache.prepareStaticVertices(second);
    cache.prepareStaticVertices(third);
    cache.synchronizePreparedRenderTreeVertexArrays(new Set([second]));

    expect(calls.deleteBuffer).toEqual([calls.createBuffer[1], calls.createBuffer[3]]);
    expect(cache.getFrameMetrics()).toMatchObject({
      staticBufferCreationCount: 3,
      staticBufferReleaseCount: 2,
      staticBufferCount: 1,
    });
  });

  it("deletes the dynamic buffer and promoted static buffers on dispose", () => {
    const { gl, calls } = makeFakeGL();
    const cache = createWebGLVertexBufferCache(gl);
    const vertices = new Float32Array([0, 0, 1, 0, 1, 1]);

    cache.bindVertices(vertices);
    cache.bindVertices(vertices);
    cache.dispose();

    expect(calls.deleteBuffer).toEqual(calls.createBuffer);
  });
});
