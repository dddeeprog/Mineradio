(function(root) {
  'use strict';

  var defaultSelection = {
    hoverHourIndex: null,
    lockedHourIndex: null,
    selectedDayIndex: null,
    expandedMetricKey: null,
    selectedMetricKey: 'temperature',
  };

  function cloneDefaultSelection() {
    return {
      hoverHourIndex: null,
      lockedHourIndex: null,
      selectedDayIndex: null,
      expandedMetricKey: null,
      selectedMetricKey: 'temperature',
    };
  }

  function fallbackEscHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function(ch) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
    });
  }

  function createHomeWeatherUi(context) {
    context = context || {};
    var selection = cloneDefaultSelection();
    var homeWeatherInteractionsBound = false;
    var weatherCityControlsBound = false;
    var documentCloseBound = false;

    function escHtml(value) {
      return typeof context.escHtml === 'function' ? context.escHtml(value) : fallbackEscHtml(value);
    }

    function formatWeatherClock(value) {
      var text = String(value || '');
      var match = text.match(/T(\d{2}:\d{2})/);
      if (match) return match[1];
      var parsed = Date.parse(text);
      if (isFinite(parsed)) return new Date(parsed).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      return text || '--:--';
    }

    function weatherState() {
      return typeof context.getWeatherState === 'function' ? (context.getWeatherState() || {}) : {};
    }

    function buildFields() {
      return typeof context.buildFields === 'function' ? (context.buildFields() || {}) : {};
    }

    function buildScene() {
      if (typeof context.buildScene === 'function') return context.buildScene() || {};
      return { className: 'home-weather-scene weather-scene-clear weather-scene-day' };
    }

    function buildAlert() {
      if (typeof context.buildAlert === 'function') return context.buildAlert() || {};
      return { title: '天气提醒', text: '天气正在整理，先按常规出行准备。' };
    }

    function buildDailyFields() {
      return typeof context.buildDailyFields === 'function' ? (context.buildDailyFields() || []) : [];
    }

    function buildCurve() {
      if (typeof context.buildCurve === 'function') {
        return context.buildCurve(selection) || {};
      }
      return { points: [], path: '', smoothPath: '', areaPath: '', selectedPoint: null };
    }

    function buildCurveMetricOptions() {
      return typeof context.buildCurveMetricOptions === 'function' ? (context.buildCurveMetricOptions() || []) : [{ key: 'temperature', label: '温度' }];
    }

    function buildMetrics(selectedDay) {
      return typeof context.buildMetrics === 'function' ? (context.buildMetrics(selectedDay) || []) : [];
    }

    function buildAdvice() {
      return typeof context.buildAdvice === 'function' ? (context.buildAdvice() || []) : [];
    }

    function weatherLivelyUi() {
      return context.weatherLivelyUi || null;
    }

    function resolveSelection(action) {
      if (typeof context.resolveSelection === 'function') {
        selection = context.resolveSelection(selection, action || {}) || cloneDefaultSelection();
      } else if (action && action.type === 'reset') {
        selection = cloneDefaultSelection();
      }
      return selection;
    }

    function selectedHomeWeatherDay(dailyRows) {
      dailyRows = dailyRows || buildDailyFields();
      var idx = Number(selection && selection.selectedDayIndex);
      return isFinite(idx) && idx >= 0 ? dailyRows[Math.round(idx)] : null;
    }

    function selectedHomeWeatherHourPoint(curve) {
      curve = curve || buildCurve();
      if (curve.selectedPoint) return curve.selectedPoint;
      var idx = selection.lockedHourIndex != null ? selection.lockedHourIndex : selection.hoverHourIndex;
      idx = Number(idx);
      return isFinite(idx) && idx >= 0 ? (curve.points || [])[Math.round(idx)] : null;
    }

    function renderWeatherIcon(iconKey) {
      iconKey = String(iconKey || 'clear-day');
      return '<span class="home-weather-icon home-weather-icon-' + escHtml(iconKey) + '" aria-hidden="true"></span>';
    }

    function renderMetricInstrument(item) {
      var instrument = item && item.instrument || {};
      var type = instrument.type || 'none';
      if (type === 'ring') {
        return '<div class="home-weather-instrument home-weather-instrument-ring" style="--p:' + escHtml(instrument.percent || 0) + '"><span>' + escHtml(item.value || '--') + '</span></div>';
      }
      if (type === 'compass') {
        return '<div class="home-weather-instrument home-weather-instrument-compass" style="--deg:' + escHtml(instrument.degrees || 0) + 'deg;--p:' + escHtml(instrument.percent || 0) + '"><span></span></div>';
      }
      if (type === 'sunArc') {
        return '<div class="home-weather-instrument home-weather-instrument-sun" style="--p:' + escHtml(instrument.progress || 50) + '"><span></span></div>';
      }
      if (type === 'bar') {
        return '<div class="home-weather-instrument home-weather-instrument-bar" style="--p:' + escHtml(instrument.percent || 0) + '"><span></span></div>';
      }
      if (type === 'gauge') {
        return '<div class="home-weather-instrument home-weather-instrument-gauge" style="--p:' + escHtml(instrument.percent || 50) + '"><span></span></div>';
      }
      if (type === 'split') {
        return '<div class="home-weather-instrument home-weather-instrument-split" style="--p:' + escHtml(instrument.primary || 0) + ';--q:' + escHtml(instrument.secondary || 0) + '"><span></span><i></i></div>';
      }
      if (type === 'icon') {
        return '<div class="home-weather-instrument home-weather-instrument-icon">' + renderWeatherIcon(instrument.iconKey || item.icon || 'clear-day') + '</div>';
      }
      return '<div class="home-weather-instrument home-weather-instrument-none"></div>';
    }

    function updateWeatherCityChip(fields) {
      var state = weatherState();
      fields = fields || buildFields();
      var label = document.getElementById('weather-city-chip-label');
      var input = document.getElementById('home-weather-city-input');
      if (label) {
        var temp = fields.temperatureText && fields.temperatureText !== '--°' ? (' ' + fields.temperatureText) : '';
        label.textContent = (fields.city || state.city || '上海') + ' · ' + (fields.label || '天气') + temp;
      }
      if (input && document.activeElement !== input) input.value = state.city || fields.city || '上海';
    }

    function renderWeatherDetailPopover(fields) {
      var state = weatherState();
      fields = fields || buildFields();
      var title = document.getElementById('weather-detail-title');
      var sub = document.getElementById('weather-detail-sub');
      var grid = document.getElementById('weather-detail-grid');
      if (title) title.textContent = (fields.city || state.city || '上海') + ' · ' + (fields.label || '天气');
      if (sub) {
        var updated = state.updatedAt ? new Date(state.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '未更新';
        var observed = state.weather && state.weather.time ? formatWeatherClock(state.weather.time) : '--:--';
        sub.textContent = (state.error === 'WEATHER_CACHE_STALE' ? '缓存天气' : '天气详情') + ' · 天气 ' + observed + ' · 刷新 ' + updated;
      }
      if (grid) {
        var details = [
          ['温度', fields.temperatureText || '--°'],
          ['体感', fields.apparentText || '体感 --°'],
          ['湿度', fields.humidityText || '湿度 --'],
          ['风速', fields.windText || '风速 --'],
          ['降水', fields.precipitationText || '降水 --'],
          ['云量', fields.cloudText || '云量 --'],
        ];
        grid.innerHTML = details.map(function(item) {
          return '<div class="weather-detail-item"><b>' + escHtml(item[0]) + '</b><span>' + escHtml(item[1]) + '</span></div>';
        }).join('');
      }
    }

    function renderHomeWeatherScene() {
      var scene = buildScene();
      var el = document.getElementById('home-weather-scene');
      if (el) el.className = scene.className || 'home-weather-scene weather-scene-clear weather-scene-day';
      var lively = weatherLivelyUi();
      if (lively && typeof lively.syncWeatherVisual === 'function') lively.syncWeatherVisual(scene);
    }

    function renderHomeWeatherAlert() {
      var alert = buildAlert();
      var el = document.getElementById('home-weather-alert');
      if (el) el.textContent = (alert.title ? (alert.title + ' · ') : '') + (alert.text || '天气正在整理，先按常规出行准备。');
    }

    function renderHomeWeatherCurve(fields) {
      var curve = buildCurve();
      var line = document.getElementById('home-weather-curve-line');
      var glow = document.getElementById('home-weather-curve-line-glow');
      var area = document.getElementById('home-weather-curve-area');
      var forecast = document.getElementById('home-weather-forecast');
      var ticks = document.getElementById('home-weather-hour-ticks');
      var tabs = document.getElementById('home-weather-curve-tabs');
      var icons = document.getElementById('home-weather-curve-icons');
      var values = document.getElementById('home-weather-value-labels');
      var guide = document.getElementById('home-weather-selected-guide');
      var preview = document.getElementById('home-weather-hour-preview');
      var selected = selectedHomeWeatherHourPoint(curve);
      var metricKey = curve.metricKey || selection.selectedMetricKey || 'temperature';
      var tickRows = curve.timeTicks || curve.points || [];
      var iconRows = curve.iconRow || curve.points || [];
      var valueRows = curve.valueLabels || [];
      var displayPoint = selected || (curve.points || [])[0] || null;
      if (tabs) {
        tabs.innerHTML = buildCurveMetricOptions().map(function(item) {
          var active = metricKey === item.key;
          return '<button class="home-weather-curve-tab' + (active ? ' active' : '') + '" type="button" data-weather-curve-metric="' + escHtml(item.key || '') + '">' + escHtml(item.label || '指标') + '</button>';
        }).join('');
      }
      if (line) line.setAttribute('d', curve.smoothPath || curve.path || '');
      if (glow) glow.setAttribute('d', curve.smoothPath || curve.path || '');
      if (area) area.setAttribute('d', curve.areaPath || '');
      if (guide) {
        guide.setAttribute('x1', displayPoint ? displayPoint.x : 0);
        guide.setAttribute('x2', displayPoint ? displayPoint.x : 0);
        guide.style.opacity = displayPoint ? '1' : '0';
      }
      if (ticks) {
        ticks.innerHTML = tickRows.map(function(tick) {
          var active = selected && selected.index === tick.index;
          var hourTick = tick.text || String(tick.hourLabel || '--:--').slice(0, 2);
          return '<button class="home-weather-hour' + (active ? ' active' : '') + '" type="button" data-weather-hour="' + tick.index + '">' +
            '<span class="home-weather-hour-dot"></span>' +
            '<span class="home-weather-hour-time">' + escHtml(hourTick) + '</span>' +
          '</button>';
        }).join('');
      } else if (forecast) {
        forecast.innerHTML = '';
      }
      if (icons) {
        icons.innerHTML = iconRows.map(function(icon) {
          var x = Math.max(3, Math.min(97, Number(icon.x) || 0));
          return '<span class="home-weather-curve-icon" style="left:' + x + '%">' + renderWeatherIcon(icon.iconKey || 'clear-day') + '</span>';
        }).join('');
      }
      if (values) {
        values.innerHTML = displayPoint ? valueRows.filter(function(item) {
          return item.index === displayPoint.index;
        }).map(function(item) {
          var labelX = Math.max(5, Math.min(95, Number(item.x) || 0));
          var labelY = Math.max(12, Math.min(70, Number(item.y) || 0));
          return '<span class="home-weather-value-label" style="left:' + labelX + '%;top:' + labelY + '%">' + escHtml(item.text || item.valueText || '') + '</span>';
        }).join('') : '';
      }
      if (preview) {
        if (selected) preview.textContent = selected.hourLabel + ' · ' + (curve.metricLabel || '指标') + ' ' + (selected.valueText || selected.temperatureText || '--') + ' · ' + selected.label + ' · 降水 ' + selected.rainText;
        else preview.textContent = (curve.scopeLabel || '未来 12 小时') + ' · ' + (curve.metricLabel || '温度') + '趋势（' + (curve.axisUnit || '°') + '）';
      }
      var lively = weatherLivelyUi();
      if (lively && typeof lively.syncGraphModel === 'function') {
        lively.syncGraphModel(curve, { metricKey: metricKey, selection: selection, selectedPoint: displayPoint });
      }
    }

    function renderHomeWeatherDaily(dailyRows) {
      var daily = document.getElementById('home-weather-daily');
      if (!daily) return;
      dailyRows = dailyRows || buildDailyFields();
      daily.innerHTML = dailyRows.length ? dailyRows.map(function(day, index) {
        var active = selection.selectedDayIndex === index;
        return '<button class="home-weather-day' + (active ? ' active' : '') + '" type="button" data-weather-day="' + index + '">' +
          '<div class="home-weather-day-date">' + escHtml(day.date ? day.date.slice(5) : '--/--') + '</div>' +
          '<div class="home-weather-day-name">' + escHtml(day.dayLabel || '未来') + '</div>' +
          '<div class="home-weather-day-icon">' + renderWeatherIcon(day.iconKey || 'clear-day') + '</div>' +
          '<div class="home-weather-day-rain">' + escHtml(day.label || '天气') + ' · ' + escHtml(day.rainText || '--') + '</div>' +
          '<div class="home-weather-day-range">' + escHtml(day.rangeText || '-- / --') + '</div>' +
        '</button>';
      }).join('') : '<button class="home-weather-day active" type="button"><div class="home-weather-day-name">现在</div><div class="home-weather-day-rain">等待刷新</div><div class="home-weather-day-range">-- / --</div></button>';
    }

    function renderHomeWeatherMetrics(selectedDay) {
      var metrics = document.getElementById('home-weather-metrics');
      if (!metrics) return;
      var rows = buildMetrics(selectedDay);
      metrics.innerHTML = rows.map(function(item) {
        var active = selection.expandedMetricKey === item.key;
        return '<button class="home-weather-metric' + (active ? ' active' : '') + '" type="button" data-weather-metric="' + escHtml(item.key || '') + '">' +
          renderMetricInstrument(item) +
          '<div class="home-weather-metric-title">' + escHtml(item.title || '指标') + '</div>' +
          '<div class="home-weather-metric-value">' + escHtml(item.value || '--') + '</div>' +
          '<div class="home-weather-metric-detail">' + escHtml(item.detail || '') + '</div>' +
        '</button>';
      }).join('');
      var lively = weatherLivelyUi();
      if (lively && typeof lively.syncMetricCards === 'function') lively.syncMetricCards(rows, selection);
    }

    function renderHomeWeatherHero() {
      var fields = buildFields();
      var temp = document.getElementById('home-weather-temp');
      var city = document.getElementById('home-weather-city');
      var label = document.getElementById('home-weather-label');
      var meta = document.getElementById('home-weather-meta');
      var kicker = document.getElementById('home-weather-kicker');
      var advice = document.getElementById('home-weather-advice');
      if (temp) temp.textContent = String(fields.temperatureText || '--°').replace(/°$/, '');
      if (city) city.textContent = fields.city || '上海';
      if (label) label.textContent = fields.label || '天气';
      if (kicker) kicker.textContent = fields.moodTitle || 'Weather Console';
      if (meta) {
        var pills = [fields.apparentText, fields.humidityText, fields.windText, fields.precipitationText, fields.cloudText].filter(Boolean);
        meta.innerHTML = pills.map(function(text) {
          return '<span class="home-weather-pill">' + escHtml(text) + '</span>';
        }).join('');
      }
      renderHomeWeatherScene();
      renderHomeWeatherAlert();
      renderHomeWeatherCurve(fields);
      var dailyRows = buildDailyFields();
      renderHomeWeatherDaily(dailyRows);
      renderHomeWeatherMetrics(selectedHomeWeatherDay(dailyRows));
      if (advice) {
        var adviceRows = buildAdvice().slice(0, 3);
        advice.innerHTML = adviceRows.map(function(item) {
          return '<div class="home-weather-advice-card"><div class="home-weather-advice-title">' + escHtml(item.title || '建议') + '</div><div class="home-weather-advice-text">' + escHtml(item.text || '') + '</div></div>';
        }).join('');
      }
      var lively = weatherLivelyUi();
      if (lively && typeof lively.decorateDashboard === 'function') {
        lively.decorateDashboard({ fields: fields, selection: selection });
      }
      updateWeatherCityChip(fields);
      renderWeatherDetailPopover(fields);
    }

    function syncHomeWeatherInteractionState() {
      return selection;
    }

    function bindHomeWeatherInteractions() {
      if (homeWeatherInteractionsBound) return;
      var hero = document.querySelector('.home-hero');
      var forecast = document.getElementById('home-weather-forecast');
      var curveTabs = document.getElementById('home-weather-curve-tabs');
      var daily = document.getElementById('home-weather-daily');
      var metrics = document.getElementById('home-weather-metrics');
      var nowBtn = document.getElementById('home-weather-now-btn');
      if (hero) {
        hero.addEventListener('mousemove', function(e) {
          var scene = document.getElementById('home-weather-scene');
          if (!scene) return;
          var rect = hero.getBoundingClientRect();
          var x = ((e.clientX - rect.left) / Math.max(1, rect.width) - 0.5) * 18;
          var y = ((e.clientY - rect.top) / Math.max(1, rect.height) - 0.5) * 14;
          scene.style.setProperty('--wx', x.toFixed(1) + 'px');
          scene.style.setProperty('--wy', y.toFixed(1) + 'px');
        });
        hero.addEventListener('mouseleave', function() {
          var scene = document.getElementById('home-weather-scene');
          if (scene) {
            scene.style.setProperty('--wx', '0px');
            scene.style.setProperty('--wy', '0px');
          }
        });
      }
      if (forecast) {
        forecast.addEventListener('mouseover', function(e) {
          var btn = e.target && e.target.closest && e.target.closest('[data-weather-hour]');
          if (!btn || selection.lockedHourIndex != null) return;
          resolveSelection({ type: 'hoverHour', index: btn.getAttribute('data-weather-hour') });
          renderHomeWeatherHero(false);
        });
        forecast.addEventListener('mouseleave', function() {
          if (selection.lockedHourIndex != null) return;
          resolveSelection({ type: 'leaveHourly' });
          renderHomeWeatherHero(false);
        });
        forecast.addEventListener('click', function(e) {
          var btn = e.target && e.target.closest && e.target.closest('[data-weather-hour]');
          if (!btn) return;
          e.preventDefault();
          e.stopPropagation();
          resolveSelection({ type: 'clickHour', index: btn.getAttribute('data-weather-hour') });
          renderHomeWeatherHero(false);
        });
      }
      if (curveTabs) {
        curveTabs.addEventListener('click', function(e) {
          var btn = e.target && e.target.closest && e.target.closest('[data-weather-curve-metric]');
          if (!btn) return;
          e.preventDefault();
          e.stopPropagation();
          resolveSelection({ type: 'clickCurveMetric', key: btn.getAttribute('data-weather-curve-metric') });
          renderHomeWeatherHero(false);
        });
      }
      if (daily) {
        daily.addEventListener('click', function(e) {
          var btn = e.target && e.target.closest && e.target.closest('[data-weather-day]');
          if (!btn) return;
          e.preventDefault();
          e.stopPropagation();
          resolveSelection({ type: 'clickDay', index: btn.getAttribute('data-weather-day') });
          renderHomeWeatherHero(false);
        });
      }
      if (metrics) {
        metrics.addEventListener('click', function(e) {
          var btn = e.target && e.target.closest && e.target.closest('[data-weather-metric]');
          if (!btn) return;
          e.preventDefault();
          e.stopPropagation();
          resolveSelection({ type: 'clickMetric', key: btn.getAttribute('data-weather-metric') });
          renderHomeWeatherHero(false);
        });
      }
      if (nowBtn) {
        nowBtn.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          resolveSelection({ type: 'reset' });
          renderHomeWeatherHero(false);
        });
      }
      homeWeatherInteractionsBound = true;
    }

    function closeWeatherDetailPopover() {
      var wrap = document.getElementById('weather-city-wrap');
      if (wrap) wrap.classList.remove('open');
    }

    function toggleWeatherDetailPopover(e) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      var wrap = document.getElementById('weather-city-wrap');
      if (!wrap) return;
      var open = !wrap.classList.contains('open');
      wrap.classList.toggle('open', open);
      if (open) renderWeatherDetailPopover();
    }

    function closeHomeWeatherCityEditor() {
      var wrap = document.getElementById('home-weather-city-editor-wrap');
      if (wrap) wrap.classList.remove('open');
    }

    function openHomeWeatherCityEditor(e) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      closeWeatherDetailPopover();
      var state = weatherState();
      var wrap = document.getElementById('home-weather-city-editor-wrap');
      var input = document.getElementById('home-weather-city-input');
      if (!wrap) return;
      wrap.classList.add('open');
      if (input) {
        input.value = state.city || '上海';
        setTimeout(function() { input.focus(); input.select(); }, 40);
      }
    }

    function closeWeatherCityEditor() {
      closeWeatherDetailPopover();
      closeHomeWeatherCityEditor();
    }

    function applyWeatherCity(city) {
      city = String(city || '').trim();
      if (!city) return;
      var state = weatherState();
      state.city = city;
      try { localStorage.setItem(context.cityKey || 'mineradio-weather-city', city); } catch (e) {}
      state.loaded = false;
      state.error = '';
      state.weather = null;
      state.radio = null;
      state.updatedAt = 0;
      resolveSelection({ type: 'reset' });
      try { localStorage.removeItem(context.cacheKey || 'mineradio-weather-radio-cache-v1'); } catch (e) {}
      updateWeatherCityChip();
      renderHomeWeatherHero(false);
      closeWeatherCityEditor();
      if (typeof context.loadWeather === 'function') context.loadWeather(true, { city: city });
      if (typeof context.showToast === 'function') context.showToast('天气城市已切换到 ' + city);
    }

    function submitHomeWeatherCityInput() {
      var input = document.getElementById('home-weather-city-input');
      applyWeatherCity(input ? input.value : '');
    }

    function bindDocumentCityCloseHandlers() {
      if (documentCloseBound) return;
      document.addEventListener('click', function(e) {
        var detailWrap = document.getElementById('weather-city-wrap');
        var homeWrap = document.getElementById('home-weather-city-editor-wrap');
        var clickedDetail = detailWrap && detailWrap.contains(e.target);
        var clickedHome = homeWrap && homeWrap.contains(e.target);
        if (detailWrap && detailWrap.classList.contains('open') && !clickedDetail) closeWeatherDetailPopover();
        if (homeWrap && homeWrap.classList.contains('open') && !clickedHome) closeHomeWeatherCityEditor();
      });
      document.addEventListener('keydown', function(e) {
        var input = document.getElementById('home-weather-city-input');
        var homeWrap = document.getElementById('home-weather-city-editor-wrap');
        var cityOpen = homeWrap && homeWrap.classList.contains('open');
        if (e.key === 'Escape' && cityOpen) {
          e.preventDefault();
          closeWeatherCityEditor();
          return;
        }
        if (!input || document.activeElement !== input) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          submitHomeWeatherCityInput();
        }
      });
      documentCloseBound = true;
    }

    function bindWeatherCityEditorControls() {
      if (weatherCityControlsBound) return;
      var homeBtn = document.getElementById('home-weather-city-switch');
      var chip = document.getElementById('weather-city-chip');
      var submitBtn = document.getElementById('home-weather-city-submit-btn');
      var locateBtn = document.getElementById('home-weather-city-locate-btn');
      var cancelBtn = document.getElementById('home-weather-city-cancel-btn');
      var pop = document.getElementById('home-weather-city-pop');
      if (homeBtn && !homeBtn._weatherCityBound) {
        homeBtn._weatherCityBound = true;
        homeBtn.addEventListener('click', openHomeWeatherCityEditor);
      }
      if (chip && !chip._weatherCityBound) {
        chip._weatherCityBound = true;
        chip.addEventListener('click', toggleWeatherDetailPopover);
      }
      if (submitBtn && !submitBtn._weatherCityBound) {
        submitBtn._weatherCityBound = true;
        submitBtn.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); submitHomeWeatherCityInput(); });
      }
      if (locateBtn && !locateBtn._weatherCityBound) {
        locateBtn._weatherCityBound = true;
        locateBtn.addEventListener('click', function(e) {
          e.preventDefault();
          e.stopPropagation();
          if (typeof context.locateWeather === 'function') context.locateWeather();
          closeWeatherCityEditor();
        });
      }
      if (cancelBtn && !cancelBtn._weatherCityBound) {
        cancelBtn._weatherCityBound = true;
        cancelBtn.addEventListener('click', function(e) { e.preventDefault(); e.stopPropagation(); closeWeatherCityEditor(); });
      }
      if (pop && !pop._weatherCityBound) {
        pop._weatherCityBound = true;
        pop.addEventListener('click', function(e) { if (e.target === pop) closeHomeWeatherCityEditor(); });
      }
      bindDocumentCityCloseHandlers();
      weatherCityControlsBound = true;
    }

    return {
      renderHomeWeatherHero: renderHomeWeatherHero,
      updateWeatherCityChip: updateWeatherCityChip,
      renderWeatherDetailPopover: renderWeatherDetailPopover,
      syncHomeWeatherInteractionState: syncHomeWeatherInteractionState,
      bindHomeWeatherInteractions: bindHomeWeatherInteractions,
      closeWeatherDetailPopover: closeWeatherDetailPopover,
      toggleWeatherDetailPopover: toggleWeatherDetailPopover,
      closeHomeWeatherCityEditor: closeHomeWeatherCityEditor,
      openHomeWeatherCityEditor: openHomeWeatherCityEditor,
      closeWeatherCityEditor: closeWeatherCityEditor,
      applyWeatherCity: applyWeatherCity,
      submitHomeWeatherCityInput: submitHomeWeatherCityInput,
      bindWeatherCityEditorControls: bindWeatherCityEditorControls,
      resolveSelection: resolveSelection,
      getSelection: function() { return selection; },
    };
  }

  var api = {
    init: createHomeWeatherUi,
  };

  if (typeof window !== 'undefined') window.MineradioHomeWeatherUi = api;
  else root.MineradioHomeWeatherUi = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
