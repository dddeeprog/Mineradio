(function(root, factory) {
  var api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MineradioPlatformLoginUI = api;
})(typeof window !== 'undefined'
  ? window
  : (typeof globalThis !== 'undefined' ? globalThis : this), function(root) {
  'use strict';

  var PROVIDER_MARKS = Object.freeze({
    netease: 'NE',
    qq: 'QQ',
    kugou: 'KG',
    qishui: 'QS',
    spotify: 'SP'
  });
  var METHOD_COPY = Object.freeze({
    qr: Object.freeze({
      label: '二维码',
      description: '使用官方 App 扫码确认'
    }),
    cookie: Object.freeze({
      label: 'Cookie 导入',
      description: '手动导入当前平台会话'
    }),
    token: Object.freeze({
      label: 'Token 导入',
      description: '手动导入平台访问令牌'
    }),
    pkce: Object.freeze({
      label: 'Spotify 授权',
      description: '通过官方 PKCE 登录，不保存客户端密钥'
    }),
    'external-window': Object.freeze({
      label: '官方窗口',
      description: '在隔离的官方页面完成登录'
    })
  });

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function providerDescription(item) {
    if (item.metadataOnly) {
      return item.loggedIn
        ? '已连接 · 仅同步账号与搜索元数据'
        : '仅同步账号与搜索元数据';
    }
    if (item.loggedIn) return '已连接 · 播放能力按账号状态启用';
    return '同步账号、音乐库与可用播放能力';
  }

  function renderProviderRows(state) {
    var providers = state && Array.isArray(state.providers)
      ? state.providers
      : [];
    return providers.map(function(item) {
      var selected = item.provider === state.selectedProvider;
      var mark = PROVIDER_MARKS[item.provider] || '?';
      return '<button class="platform-login-provider-row'
        + (selected ? ' active' : '')
        + '" type="button" data-login-provider="'
        + escapeHtml(item.provider)
        + '" aria-current="' + (selected ? 'true' : 'false') + '">'
        + '<span class="platform-login-provider-icon '
        + escapeHtml(item.provider) + '" aria-hidden="true">'
        + escapeHtml(mark) + '</span>'
        + '<span class="platform-login-provider-copy"><b>'
        + escapeHtml(item.label) + '</b><small>'
        + escapeHtml(providerDescription(item)) + '</small></span>'
        + '<span class="platform-login-provider-arrow" aria-hidden="true">›</span>'
        + '</button>';
    }).join('');
  }

  function selectedItem(state) {
    if (!state || !Array.isArray(state.providers)) return null;
    return state.providers.find(function(item) {
      return item && item.provider === state.selectedProvider;
    }) || null;
  }

  function renderAuthMethods(state) {
    var item = selectedItem(state);
    if (!item) return '';
    return item.authMethods.map(function(method) {
      var copy = METHOD_COPY[method] || {
        label: method,
        description: '使用该平台提供的登录方式'
      };
      return '<button class="platform-login-method-row" type="button"'
        + ' data-login-method="' + escapeHtml(method) + '">'
        + '<span class="platform-login-method-copy"><b>'
        + escapeHtml(copy.label) + '</b><small>'
        + escapeHtml(copy.description) + '</small></span>'
        + '<span class="platform-login-provider-arrow" aria-hidden="true">›</span>'
        + '</button>';
    }).join('');
  }

  function mountLoginCenter(options) {
    options = options && typeof options === 'object' ? options : {};
    var providerRoot = options.providerRoot;
    var methodRoot = options.methodRoot;
    if (!providerRoot || !methodRoot) {
      throw new TypeError('providerRoot and methodRoot are required');
    }
    var state = options.state;
    var onProvider = typeof options.onProvider === 'function'
      ? options.onProvider
      : function() {};
    var onMethod = typeof options.onMethod === 'function'
      ? options.onMethod
      : function() {};

    function render() {
      providerRoot.innerHTML = renderProviderRows(state);
      methodRoot.innerHTML = renderAuthMethods(state);
    }

    function providerClick(event) {
      var target = event.target && event.target.closest
        ? event.target.closest('[data-login-provider]')
        : null;
      if (!target || !providerRoot.contains(target)) return;
      onProvider(target.getAttribute('data-login-provider'));
    }

    function methodClick(event) {
      var target = event.target && event.target.closest
        ? event.target.closest('[data-login-method]')
        : null;
      if (!target || !methodRoot.contains(target)) return;
      onMethod(
        state && state.selectedProvider,
        target.getAttribute('data-login-method')
      );
    }

    providerRoot.addEventListener('click', providerClick);
    methodRoot.addEventListener('click', methodClick);
    render();
    return Object.freeze({
      setState: function(nextState) {
        state = nextState;
        render();
      },
      destroy: function() {
        providerRoot.removeEventListener('click', providerClick);
        methodRoot.removeEventListener('click', methodClick);
        providerRoot.innerHTML = '';
        methodRoot.innerHTML = '';
      }
    });
  }

  return {
    mountLoginCenter: mountLoginCenter,
    renderAuthMethods: renderAuthMethods,
    renderProviderRows: renderProviderRows
  };
});
