(function(root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioNativeLyricRegistry = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';

  var REQUIRED_METHODS = ['mount', 'setDocument', 'update', 'resize', 'release', 'destroy'];

  function validateRenderer(renderer, name) {
    if (!renderer || typeof renderer !== 'object') throw new Error('Renderer "' + name + '" did not return an object');
    REQUIRED_METHODS.forEach(function(method) {
      if (typeof renderer[method] !== 'function') throw new Error('Renderer "' + name + '" is missing ' + method + '()');
    });
    return renderer;
  }

  function createRendererRegistry() {
    var loaders = Object.create(null);
    var factories = Object.create(null);
    var pending = Object.create(null);

    function register(name, loader) {
      name = String(name || '').trim();
      if (!name) throw new Error('Renderer name is required');
      if (typeof loader !== 'function') throw new Error('Renderer loader must be a function');
      loaders[name] = loader;
      delete factories[name];
      delete pending[name];
      return api;
    }

    function load(name) {
      if (factories[name]) return Promise.resolve(factories[name]);
      if (pending[name]) return pending[name];
      if (!loaders[name]) return Promise.reject(new Error('Unknown renderer: ' + name));
      pending[name] = Promise.resolve().then(function() { return loaders[name](); }).then(function(factory) {
        if (factory && typeof factory.create === 'function') factory = factory.create;
        if (typeof factory !== 'function') throw new Error('Renderer loader "' + name + '" did not return a factory');
        factories[name] = factory;
        delete pending[name];
        return factory;
      }, function(error) {
        delete pending[name];
        throw error;
      });
      return pending[name];
    }

    function create(name, context) {
      return load(name).then(function(factory) {
        return validateRenderer(factory(context || {}), name);
      });
    }

    var api = {
      register: register,
      load: load,
      create: create,
      has: function(name) { return !!loaders[name]; },
      names: function() { return Object.keys(loaders); },
      clear: function() {
        loaders = Object.create(null);
        factories = Object.create(null);
        pending = Object.create(null);
      },
    };
    return api;
  }

  return {
    REQUIRED_METHODS: REQUIRED_METHODS.slice(),
    validateRenderer: validateRenderer,
    createRendererRegistry: createRendererRegistry,
  };
});
