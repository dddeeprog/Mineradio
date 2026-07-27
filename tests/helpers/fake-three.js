'use strict';

function vector3(x = 0, y = 0, z = 0) {
  return {
    x, y, z,
    set(nextX, nextY, nextZ) { this.x = nextX; this.y = nextY; this.z = nextZ; return this; },
    setScalar(value) { this.x = value; this.y = value; this.z = value; return this; },
    copy(other) { this.x = other.x; this.y = other.y; this.z = other.z; return this; },
    clone() { return vector3(this.x, this.y, this.z); },
  };
}

function quaternion(x = 0, y = 0, z = 0, w = 1) {
  return {
    x, y, z, w,
    set(nextX, nextY, nextZ, nextW) { this.x = nextX; this.y = nextY; this.z = nextZ; this.w = nextW; return this; },
    copy(other) { this.x = other.x; this.y = other.y; this.z = other.z; this.w = other.w; return this; },
    clone() { return quaternion(this.x, this.y, this.z, this.w); },
  };
}

class Object3D {
  constructor() {
    this.children = [];
    this.parent = null;
    this.position = vector3();
    this.rotation = vector3();
    this.quaternion = quaternion();
    this.scale = vector3(1, 1, 1);
    this.visible = true;
    this.renderOrder = 0;
    this.userData = {};
    this.layers = { mask: 1, set(value) { this.mask = 1 << value; } };
  }

  add(...objects) {
    objects.forEach(object => {
      if (!object) return;
      if (object.parent) object.parent.remove(object);
      object.parent = this;
      this.children.push(object);
    });
    return this;
  }

  remove(object) {
    const index = this.children.indexOf(object);
    if (index >= 0) this.children.splice(index, 1);
    if (object) object.parent = null;
    return this;
  }

  clone(deep = true) {
    const clone = new this.constructor();
    clone.position.copy(this.position);
    clone.rotation.copy(this.rotation);
    clone.quaternion.copy(this.quaternion);
    clone.scale.copy(this.scale);
    clone.visible = this.visible;
    clone.renderOrder = this.renderOrder;
    clone.layers.mask = this.layers.mask;
    if (deep) this.children.forEach(child => clone.add(child.clone(true)));
    return clone;
  }
}

class Group extends Object3D {}
class Scene extends Group {}

class BufferAttribute {
  constructor(array, itemSize) {
    this.array = array;
    this.itemSize = itemSize;
    this.count = array.length / itemSize;
    this.needsUpdate = false;
    this.usage = null;
  }

  setUsage(value) { this.usage = value; return this; }
  clone() { return new this.constructor(this.array.slice(0), this.itemSize); }
}

class InstancedBufferAttribute extends BufferAttribute {}

class InstancedBufferGeometry {
  constructor() {
    this.attributes = {};
    this.index = null;
    this.disposeCount = 0;
    this.instanceCount = Infinity;
  }

  setAttribute(name, attribute) { this.attributes[name] = attribute; return this; }
  getAttribute(name) { return this.attributes[name]; }
  setIndex(index) { this.index = index && typeof index.clone === 'function' ? index.clone() : index; return this; }
  copy(source) {
    this.attributes = {};
    Object.keys(source.attributes || {}).forEach(name => {
      const attribute = source.attributes[name];
      this.attributes[name] = attribute && typeof attribute.clone === 'function' ? attribute.clone() : attribute;
    });
    this.index = source.index && typeof source.index.clone === 'function' ? source.index.clone() : source.index;
    return this;
  }
  dispose() { this.disposeCount += 1; }
}

class BufferGeometry extends InstancedBufferGeometry {
  constructor() {
    super();
    this.drawRange = { start: 0, count: Infinity };
  }

  setDrawRange(start, count) {
    this.drawRange = { start, count };
  }
}

class PlaneGeometry extends InstancedBufferGeometry {
  constructor(width = 1, height = 1) {
    super();
    this.parameters = { width, height };
    this.setAttribute('position', new BufferAttribute(new Float32Array([
      -0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0,
    ]), 3));
    this.setAttribute('uv', new BufferAttribute(new Float32Array([
      0, 0, 1, 0, 1, 1, 0, 1,
    ]), 2));
    this.setIndex(new BufferAttribute(new Uint16Array([0, 1, 2, 0, 2, 3]), 1));
  }
}

class Matrix4 {
  constructor() {
    this.elements = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  }
  identity() { return this.fromArray([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); }
  fromArray(values) { this.elements = Array.from(values); return this; }
  clone() { return new Matrix4().fromArray(this.elements); }
}

class Color {
  constructor(value = '#ffffff') { this.value = value; }
  set(value) { this.value = value; return this; }
  clone() { return new Color(this.value); }
}

class Material {
  constructor(options = {}) {
    Object.assign(this, options);
    this.disposeCount = 0;
  }
  dispose() { this.disposeCount += 1; }
}

class ShaderMaterial extends Material {}
class MeshBasicMaterial extends Material {}

class Mesh extends Object3D {
  constructor(geometry, material) {
    super();
    this.geometry = geometry;
    this.material = material;
  }
  clone(deep = true) {
    const clone = new this.constructor(this.geometry, this.material, this.maxCount);
    clone.position.copy(this.position);
    clone.rotation.copy(this.rotation);
    clone.quaternion.copy(this.quaternion);
    clone.scale.copy(this.scale);
    clone.visible = this.visible;
    clone.renderOrder = this.renderOrder;
    clone.layers.mask = this.layers.mask;
    if (deep) this.children.forEach(child => clone.add(child.clone(true)));
    return clone;
  }
}

class Points extends Object3D {
  constructor(geometry, material) {
    super();
    this.geometry = geometry;
    this.material = material;
    this.frustumCulled = true;
    this.name = '';
  }
}

class InstancedMesh extends Mesh {
  constructor(geometry, material, count) {
    super(geometry, material);
    this.maxCount = count;
    this.count = count;
    this.matrices = Array.from({ length: count }, () => new Matrix4());
    this.instanceMatrix = new InstancedBufferAttribute(new Float32Array(count * 16), 16);
  }
  setMatrixAt(index, matrix) {
    this.matrices[index] = matrix.clone();
    this.instanceMatrix.array.set(matrix.elements, index * 16);
  }
}

class CanvasTexture {
  constructor(canvas) {
    this.image = canvas;
    this.needsUpdate = false;
    this.disposeCount = 0;
  }
  dispose() { this.disposeCount += 1; }
}

class WebGLRenderTarget {
  constructor(width, height, options = {}) {
    this.width = width;
    this.height = height;
    this.options = options;
    this.texture = { disposeCount: 0, dispose() { this.disposeCount += 1; } };
    this.disposeCount = 0;
  }
  dispose() {
    this.disposeCount += 1;
    this.texture.dispose();
  }
}

function createFakeThree() {
  return {
    Object3D,
    Group,
    Scene,
    BufferAttribute,
    BufferGeometry,
    InstancedBufferAttribute,
    InstancedBufferGeometry,
    PlaneGeometry,
    Matrix4,
    Color,
    ShaderMaterial,
    MeshBasicMaterial,
    Mesh,
    Points,
    InstancedMesh,
    CanvasTexture,
    WebGLRenderTarget,
    DynamicDrawUsage: 'dynamic',
    DoubleSide: 'double',
    NormalBlending: 'normal',
    AdditiveBlending: 'additive',
    LinearFilter: 'linear',
    RGBAFormat: 'rgba',
    UnsignedByteType: 'ubyte',
  };
}

module.exports = {
  createFakeThree,
};
