;(function (window) {
  var svgSprite =
    '<svg><symbol id="icon-save-all" viewBox="0 0 1024 1024"><path d="M725.333333 298.666667 725.333333 128 298.666667 128 298.666667 298.666667 725.333333 298.666667M597.333333 725.333333C668.16 725.333333 725.333333 668.16 725.333333 597.333333 725.333333 526.506667 668.16 469.333333 597.333333 469.333333 526.506667 469.333333 469.333333 526.506667 469.333333 597.333333 469.333333 668.16 526.506667 725.333333 597.333333 725.333333M810.666667 42.666667 981.333333 213.333333 981.333333 725.333333C981.333333 772.266667 942.933333 810.666667 896 810.666667L298.666667 810.666667C251.306667 810.666667 213.333333 772.266667 213.333333 725.333333L213.333333 128C213.333333 81.066667 251.733333 42.666667 298.666667 42.666667L810.666667 42.666667M42.666667 298.666667 128 298.666667 128 896 725.333333 896 725.333333 981.333333 128 981.333333C81.066667 981.333333 42.666667 942.933333 42.666667 896L42.666667 298.666667Z"  ></path></symbol><symbol id="icon-close-all" viewBox="0 0 1024 1024"><path d="M938.666667 384V341.333333a85.333333 85.333333 0 0 0-85.333334-85.333333H341.333333a85.333333 85.333333 0 0 0-85.333333 85.333333v512a85.333333 85.333333 0 0 0 85.333333 85.333334h42.666667l42.666667 85.333333H341.333333a170.666667 170.666667 0 0 1-170.666666-170.666667 170.666667 170.666667 0 0 1-170.666667-170.666666V170.666667a170.666667 170.666667 0 0 1 170.666667-170.666667h512a170.666667 170.666667 0 0 1 170.666666 170.666667 170.666667 170.666667 0 0 1 170.666667 170.666666v85.333334zM682.666667 85.333333H170.666667a85.333333 85.333333 0 0 0-85.333334 85.333334v512a85.333333 85.333333 0 0 0 85.333334 85.333333V341.333333a170.666667 170.666667 0 0 1 170.666666-170.666666h426.666667a85.333333 85.333333 0 0 0-85.333333-85.333334zM546.133333 484.010667l180.992 180.992 181.077334-180.992 60.330666 60.330666L787.456 725.333333l181.077333 180.992-60.330666 60.330667-181.077334-180.992L546.133333 966.656l-60.330666-60.330667L666.794667 725.333333 485.802667 544.341333z"  ></path></symbol></svg>'
  var script = (function () {
    var scripts = document.getElementsByTagName('script')
    return scripts[scripts.length - 1]
  })()
  var shouldInjectCss = script.getAttribute('data-injectcss')
  var ready = function (fn) {
    if (document.addEventListener) {
      if (~['complete', 'loaded', 'interactive'].indexOf(document.readyState)) {
        setTimeout(fn, 0)
      } else {
        var loadFn = function () {
          document.removeEventListener('DOMContentLoaded', loadFn, false)
          fn()
        }
        document.addEventListener('DOMContentLoaded', loadFn, false)
      }
    } else if (document.attachEvent) {
      IEContentLoaded(window, fn)
    }
    function IEContentLoaded(w, fn) {
      var d = w.document,
        done = false,
        init = function () {
          if (!done) {
            done = true
            fn()
          }
        }
      var polling = function () {
        try {
          d.documentElement.doScroll('left')
        } catch (e) {
          setTimeout(polling, 50)
          return
        }
        init()
      }
      polling()
      d.onreadystatechange = function () {
        if (d.readyState == 'complete') {
          d.onreadystatechange = null
          init()
        }
      }
    }
  }
  var before = function (el, target) {
    target.parentNode.insertBefore(el, target)
  }
  var prepend = function (el, target) {
    if (target.firstChild) {
      before(el, target.firstChild)
    } else {
      target.appendChild(el)
    }
  }
  function appendSvg() {
    var div, svg
    div = document.createElement('div')
    div.innerHTML = svgSprite
    svgSprite = null
    svg = div.getElementsByTagName('svg')[0]
    if (svg) {
      svg.setAttribute('aria-hidden', 'true')
      svg.style.position = 'absolute'
      svg.style.width = 0
      svg.style.height = 0
      svg.style.overflow = 'hidden'
      prepend(svg, document.body)
    }
  }
  if (shouldInjectCss && !window.__iconfont__svg__cssinject__) {
    window.__iconfont__svg__cssinject__ = true
    try {
      document.write(
        '<style>.svgfont {display: inline-block;width: 1em;height: 1em;fill: currentColor;vertical-align: -0.1em;font-size:16px;}</style>'
      )
    } catch (e) {
      console && console.log(e)
    }
  }
  ready(appendSvg)
})(window)
