(function(root, factory) {
  var api = factory(root || {});
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) {
    root.MineradioActions = api.createMineradioActions();
    if (root.document) root.MineradioActions.bind(root.document);
  }
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this), function() {
  function createMineradioActions() {
    var handlers = new Map();

    function register(name, handler) {
      name = String(name || '').trim();
      if (!name || typeof handler !== 'function') return false;
      handlers.set(name, handler);
      return true;
    }

    function unregister(name) {
      return handlers.delete(String(name || '').trim());
    }

    function actionTargetFrom(event) {
      var target = event && event.target;
      if (!target) return null;
      if (typeof target.closest === 'function') return target.closest('[data-action]');
      return target && typeof target.getAttribute === 'function' && target.getAttribute('data-action') ? target : null;
    }

    function dispatch(event) {
      var target = actionTargetFrom(event);
      var name = target && target.getAttribute && target.getAttribute('data-action');
      var handler = name && handlers.get(name);
      if (!handler) return false;
      return handler(event, target);
    }

    function bind(root) {
      if (!root || typeof root.addEventListener !== 'function') return false;
      root.addEventListener('click', dispatch);
      return true;
    }

    return {
      bind: bind,
      dispatch: dispatch,
      register: register,
      unregister: unregister,
    };
  }

  return {
    createMineradioActions: createMineradioActions,
  };
});
