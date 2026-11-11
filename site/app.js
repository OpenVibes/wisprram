/* WisprRam landing page behaviour. Vanilla JS, no dependencies. Everything degrades gracefully without it. */
(function () {
  'use strict'

  var cfg = window.WISPRRAM || { owner: 'OpenVibes', repo: 'wisprram', pagesUrl: location.href, org: 'GoodLook Labs' }
  var GH = 'https://github.com/' + cfg.owner + '/' + cfg.repo
  var API = 'https://api.github.com/repos/' + cfg.owner + '/' + cfg.repo
  var $ = function (s, r) { return (r || document).querySelector(s) }
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)) }
  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // ---------------------------------------------------------------- links built from config.js
  $$('[data-gh]').forEach(function (a) { a.href = GH + a.getAttribute('data-gh') })
  var org = $('#org')
  if (org && cfg.org) org.textContent = cfg.org

  // ---------------------------------------------------------------- sticky nav border
  var nav = $('.nav')
  function onScroll() { nav.classList.toggle('scrolled', window.scrollY > 4) }
  window.addEventListener('scroll', onScroll, { passive: true }); onScroll()

  // ---------------------------------------------------------------- tiny cached JSON fetch (avoids the API rate limit)
  function cached(key, url, maxAgeMs) {
    try {
      var raw = sessionStorage.getItem(key)
      if (raw) {
        var o = JSON.parse(raw)
        if (Date.now() - o.t < maxAgeMs) return Promise.resolve(o.v)
      }
    } catch (e) { /* storage unavailable */ }
    return fetch(url, { headers: { Accept: 'application/vnd.github+json' } }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status)
      return r.json()
    }).then(function (v) {
      try { sessionStorage.setItem(key, JSON.stringify({ t: Date.now(), v: v })) } catch (e) { /* ignore */ }
      return v
    })
  }

  // ---------------------------------------------------------------- GitHub stars
  cached('wr-repo', API, 30 * 60 * 1000).then(function (repo) {
    var n = repo && repo.stargazers_count
    var el = $('#star-count')
    if (typeof n === 'number' && n > 0 && el) {
      el.textContent = n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n)
      el.hidden = false
    }
  }).catch(function () { /* fine: the button still links to the repo */ })

  // ---------------------------------------------------------------- OS detection
  function detectOS() {
    var uad = navigator.userAgentData
    var plat = ((uad && uad.platform) || navigator.platform || '').toLowerCase()
    var ua = navigator.userAgent || ''
    if (/android|iphone|ipad|ipod/i.test(ua) || (uad && uad.mobile)) return { os: 'mobile' }
    if (/mac/.test(plat) || /Macintosh/.test(ua)) return { os: 'mac' }
    if (/win/.test(plat) || /Windows/.test(ua)) return { os: 'win' }
    if (/linux|x11|cros/.test(plat) || /Linux|X11/.test(ua)) return { os: 'linux', debian: /ubuntu|debian|mint|pop!_os/i.test(ua) }
    return { os: 'other' }
  }

  // asset kind -> filename test (names are like WisprRam-0.2.0-arm64.dmg)
  var KINDS = {
    mac: function (n) { return /-arm64\.dmg$/i.test(n) },
    win: function (n) { return /\.exe$/i.test(n) },
    deb: function (n) { return /_amd64\.deb$/i.test(n) },
    appimage: function (n) { return /\.AppImage$/i.test(n) }
  }
  var LABEL = { mac: 'Download for macOS', win: 'Download for Windows', deb: 'Download for Linux (.deb)', appimage: 'Download for Linux (AppImage)' }
  var SHORT = { mac: 'macOS', win: 'Windows', deb: 'Linux', appimage: 'Linux' }

  function mb(bytes) { return (bytes / 1048576).toFixed(bytes > 104857600 ? 0 : 1) + ' MB' }

  function applyRelease(rel) {
    var assets = (rel && rel.assets) || []
    var found = {}
    Object.keys(KINDS).forEach(function (k) {
      for (var i = 0; i < assets.length; i++) if (KINDS[k](assets[i].name)) { found[k] = assets[i]; break }
    })
    var version = (rel.tag_name || '').replace(/^v/, '')

    // download cards
    $$('[data-asset]').forEach(function (a) {
      var k = a.getAttribute('data-asset')
      var meta = $('[data-meta="' + k + '"]')
      if (found[k]) {
        a.href = found[k].browser_download_url
        if (meta) meta.textContent = 'v' + version + ' · ' + mb(found[k].size)
      } else if (meta) {
        meta.textContent = version ? 'v' + version + ' · not in this release' : ''
      }
    })

    // primary buttons pick the visitor's OS
    var d = detectOS()
    var kind = d.os === 'mac' ? 'mac' : d.os === 'win' ? 'win' : d.os === 'linux' ? (d.debian || !found.appimage ? 'deb' : 'appimage') : null
    markYours(kind)
    if (kind && found[kind]) {
      setPrimary($('#dl-primary'), found[kind], LABEL[kind])
      setPrimary($('#dl-final'), found[kind], LABEL[kind])
      var note = $('#dl-note')
      if (note) note.innerHTML = 'v' + version + ' · ' + mb(found[kind].size) + ' · ' + (kind === 'mac' ? 'Apple Silicon · ' : '') + 'MIT licensed · <a href="#download">Other platforms</a>'
    } else if (kind) {
      setLabel($('#dl-primary'), LABEL[kind]); setLabel($('#dl-final'), LABEL[kind])
    }
  }

  function setPrimary(a, asset, label) {
    if (!a) return
    a.href = asset.browser_download_url
    setLabel(a, label)
  }
  function setLabel(a, label) { var s = a && $('span', a); if (s) s.textContent = label }

  function markYours(kind) {
    if (!kind) return
    var card = $('.dl[data-os="' + (kind === 'deb' ? 'linux' : kind) + '"]')
    if (card) card.classList.add('is-yours')
  }

  // Immediate OS-aware labels (before / without the API): links already point to the latest release page.
  var d0 = detectOS()
  var k0 = d0.os === 'mac' ? 'mac' : d0.os === 'win' ? 'win' : d0.os === 'linux' ? (d0.debian ? 'deb' : 'appimage') : null
  if (k0) { setLabel($('#dl-primary'), LABEL[k0]); setLabel($('#dl-final'), LABEL[k0]); markYours(k0) }
  else if (d0.os === 'mobile') {
    var note0 = $('#dl-note')
    if (note0) note0.innerHTML = 'WisprRam is a desktop app for macOS, Windows and Linux · <a href="#download">See downloads</a>'
  }

  cached('wr-release', API + '/releases/latest', 10 * 60 * 1000).then(applyRelease).catch(function () {
    // No release yet, rate limited or offline: every button already links to the releases page.
    $$('[data-meta]').forEach(function (m) { m.textContent = '' })
  })

  // ---------------------------------------------------------------- tabs
  $$('[data-tabs]').forEach(function (root) {
    var tabs = $$('[role="tab"]', root)
    function select(tab, focus) {
      tabs.forEach(function (t) {
        var on = t === tab
        t.setAttribute('aria-selected', on ? 'true' : 'false')
        t.tabIndex = on ? 0 : -1
        var p = document.getElementById(t.getAttribute('aria-controls'))
        if (p) p.hidden = !on
      })
      if (focus) tab.focus()
    }
    tabs.forEach(function (t, i) {
      t.addEventListener('click', function () { select(t) })
      t.addEventListener('keydown', function (e) {
        var n = null
        if (e.key === 'ArrowRight') n = tabs[(i + 1) % tabs.length]
        else if (e.key === 'ArrowLeft') n = tabs[(i - 1 + tabs.length) % tabs.length]
        else if (e.key === 'Home') n = tabs[0]
        else if (e.key === 'End') n = tabs[tabs.length - 1]
        if (n) { e.preventDefault(); select(n, true) }
      })
    })
    // deep link: #setup?app opens the app tab; keep simple: hash #panel-app
    if (location.hash === '#panel-app') select(tabs[1])
  })

  // ---------------------------------------------------------------- copy buttons
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text)
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea')
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0'
      document.body.appendChild(ta); ta.select()
      try { document.execCommand('copy') ? resolve() : reject(new Error('copy failed')) } catch (e) { reject(e) } finally { document.body.removeChild(ta) }
    })
  }
  $$('.copy').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var code = $('code', btn.parentNode)
      if (!code) return
      copyText(code.textContent.replace(/\s+$/, '')).then(function () {
        btn.classList.add('done')
        btn.innerHTML = '<svg class="ic" aria-hidden="true"><use href="#i-check"/></svg>'
        btn.setAttribute('aria-label', 'Copied')
        setTimeout(function () {
          btn.classList.remove('done')
          btn.innerHTML = '<svg class="ic" aria-hidden="true"><use href="#i-copy"/></svg>'
          btn.setAttribute('aria-label', 'Copy command')
        }, 1600)
      }).catch(function () { /* user can still select the text */ })
    })
  })

  // ---------------------------------------------------------------- hero demo
  var SCENES = [
    { title: 'Mail · New message', subject: 'Quick question',
      said: 'um so can you send me the uh the report by friday… no wait, monday',
      out: 'Can you send me the report by Monday?' },
    { title: 'Mail · New message', subject: 'Catching up',
      said: 'hey sam it was great to see you yesterday let’s do lunch next week',
      out: 'Hey Sam, it was great to see you yesterday. Let’s do lunch next week!' },
    { title: 'Mail · New message', subject: 'Agenda',
      said: 'for tomorrow we need to review the budget update the roadmap and book the offsite',
      out: 'For tomorrow we need to:\n1. Review the budget\n2. Update the roadmap\n3. Book the offsite' }
  ]

  var demo = $('#demo')
  if (demo) {
    var textEl = $('#demo-text'), saidEl = $('#demo-said'), subjEl = $('#demo-subject'), titleEl = $('#demo-title')
    var timers = []
    var running = false
    var visible = true
    var sceneIdx = 0

    var later = function (fn, ms) { var t = setTimeout(fn, ms); timers.push(t); return t }
    var clear = function () { timers.forEach(clearTimeout); timers = [] }
    var phase = function (p) { demo.setAttribute('data-phase', p) }
    var render = function (s) {
      // newline -> <br>, safely
      textEl.textContent = ''
      s.split('\n').forEach(function (line, i) {
        if (i) textEl.appendChild(document.createElement('br'))
        textEl.appendChild(document.createTextNode(line))
      })
    }

    var show = function (sc) { subjEl.textContent = sc.subject; titleEl.textContent = sc.title; saidEl.textContent = sc.said }

    if (reduceMotion) {
      show(SCENES[0]); render(SCENES[0].out); phase('done')
    } else {
      var play = function () {
        if (!running) return
        var sc = SCENES[sceneIdx % SCENES.length]; sceneIdx++
        show(sc); render(''); phase('idle')
        later(function () { phase('listening') }, 500)
        later(function () { phase('thinking') }, 500 + 2900)
        later(function () {
          phase('typing')
          var i = 0, out = sc.out
          ;(function tick() {
            if (!running) return
            i += 1 + (Math.random() > .6 ? 1 : 0)
            render(out.slice(0, i))
            if (i < out.length) later(tick, 22 + Math.random() * 26)
            else { phase('done'); later(function () { phase('idle'); later(play, 700) }, 3200) }
          })()
        }, 500 + 2900 + 750)
      }
      var start = function () { if (running || !visible) return; running = true; play() }
      var stop = function () { running = false; clear() }
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(function (es) {
          visible = es[0].isIntersecting
          if (visible) start(); else stop()
        }, { threshold: .25 }).observe(demo)
      } else start()
      document.addEventListener('visibilitychange', function () { if (document.hidden) stop(); else if (visible) start() })
    }
  }

  // ---------------------------------------------------------------- film: one play button, then the browser's own controls
  var film = $('#film-video')
  var filmPlay = $('#film-play')
  if (film && filmPlay) {
    film.removeAttribute('controls')
    filmPlay.hidden = false
    var showControls = function () { filmPlay.hidden = true; film.setAttribute('controls', '') }
    var startFilm = function () {
      showControls()
      var p = film.play()
      if (p && p.catch) p.catch(function () { /* blocked or failed: the native controls are there to try again */ })
    }
    filmPlay.addEventListener('click', startFilm)
    film.addEventListener('click', function () { if (!filmPlay.hidden) startFilm() })
    film.addEventListener('play', showControls)
  }

  // ---------------------------------------------------------------- scroll reveal
  if ('IntersectionObserver' in window && !reduceMotion) {
    document.documentElement.classList.add('reveal-ready')
    var targets = $$('.stat, .card, .banner, .step, .shot, .film-frame, .faq details, .section > .h2, .section > .sub')
    targets.forEach(function (el) { el.classList.add('rv') })
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target) } })
    }, { rootMargin: '0px 0px -8% 0px', threshold: .05 })
    targets.forEach(function (el) { io.observe(el) })
    var lat = $('.latency')
    if (lat) lat.classList.add('rv')
  }
})()
