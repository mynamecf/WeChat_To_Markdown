/**
 * lib/attachment.js —— 正文附件（视频 / 语音）处理
 *
 * 只做一件事：把视频 / 语音从正文里摘出来，换成 <wxmd-link> 占位，
 * 由 content.js 的 Turndown 规则输出成「[视频 1（微信视频）](播放页)」。
 * 图片不走这里（图片要下载，逻辑在 content.js）。代码块见 lib/codeblock.js，
 * 特殊排版见 lib/compat.js。
 *
 * 为什么只留链接、不下载：微信视频直链带 auth_key 签名会过期，mpvideo.qpic.cn
 * 偶发 403，视频号内容分片加密——落盘大概率是坏文件，md 里留个点不开的本地
 * 路径比留链接更糟。
 *
 * 关键点：微信把整台播放器（封面、已关注/重播/分享、观看更多、倍速条…）
 * 渲染在容器里，只替换里面的 <video> 会把几十行「已关注关注重播 分享 赞」
 * 当正文导出。所以这里一律按「最外层播放器容器」整块替换。
 */
var WXMD_ATTACH = (function () {
  'use strict';

  /** 播放器容器：由内向外找最外层的一个，整块换成占位 */
  var PLAYER_WRAP_SEL = [
    'mp-common-videosnippet',
    'mp-common-videochannels',
    '.video_iframe',
    '[id^="js_mp_video_container"]',
    '.appmsg_video',
    '[id^="js_mpvedio_wrapper"]'
  ].join(',');

  /** 播放器残留外壳：读不出地址时整块删掉，否则 UI 文案会被当正文 */
  var PLAYER_CHROME_SEL = [
    '.video_iframe',
    '.appmsg_video',
    '.video_tail_module',
    '.feed-wrapper',
    '.wx_bottom_modal_wrp',
    '.video_full-screen__head',
    '.infinity-list__wrapper',
    '.interact_video',
    '[id^="js_mpvedio_wrapper"]',
    '[id^="js_mp_video_container"]'
  ].join(',');

  /** 正文里可能是附件的节点 */
  var MEDIA_SEL = 'video, audio, iframe, mp-common-videosnippet, mp-common-videochannels';

  /**
   * 收集附件并把载体换成占位。
   * @param {Element} root 正文克隆节点（就地修改）
   * @param {Function} [log] 调试输出
   * @returns {Array<{kind:String, source:String, href:String}>}
   */
  function collect(root, log) {
    if (!root) return [];
    var doc = root.ownerDocument || document;
    var pageUrl = (doc.location && doc.location.href) || '';

    var nodes = Array.prototype.slice.call(root.querySelectorAll(MEDIA_SEL));
    var found = [];
    var taken = [];

    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (!root.contains(el)) continue;

      // 同一段视频会被「容器 + 内层 iframe/video」命中多次，按最外层容器去重，
      // 否则会多占一个编号、还会在 md 里留下指向已分离节点的空洞
      var carrier = findCarrier(el, root);
      if (taken.indexOf(carrier) >= 0) continue;

      var info = readAttachment(carrier, pageUrl);
      if (!info) continue;

      taken.push(carrier);
      found.push({ carrier: carrier, kind: info.kind, source: info.source, href: info.href });
    }

    // 容器互相嵌套时（外层 .video_iframe 里又套了个自定义标签）只保留最外层：
    // 外层被整体替换后内层节点已分离，留着会占掉一个编号却写不出链接
    found = found.filter(function (item) {
      return !found.some(function (other) {
        return other.carrier !== item.carrier && other.carrier.contains(item.carrier);
      });
    });

    // 编号按类别各算一套：视频 1/2/3、语音 1/2，不会出现「语音 5」这种串号
    var totals = {};
    found.forEach(function (it) {
      totals[it.kind] = (totals[it.kind] || 0) + 1;
    });

    var seen = {};
    found.forEach(function (item) {
      if (!root.contains(item.carrier)) return;
      seen[item.kind] = (seen[item.kind] || 0) + 1;
      var n = seen[item.kind];
      var label = item.kind
        + (totals[item.kind] > 1 ? ' ' + n : '')
        + (item.source ? '（' + item.source + '）' : '');

      var ph = doc.createElement('wxmd-link');
      ph.setAttribute('data-href', item.href);
      ph.setAttribute('data-label', label);
      // Turndown 对「没有文本内容」的元素直接走 blankReplacement，不会调用自定义规则，
      // 所以塞一段占位文本让它按有内容的节点处理（replacement 里不会用到 content）。
      ph.textContent = item.kind;
      item.carrier.replaceWith(ph);
    });

    if (typeof log === 'function') log('attachments', found.length);
    return found.map(function (it) {
      return { kind: it.kind, source: it.source, href: it.href };
    });
  }

  /**
   * 从内向外找最外层播放器容器。
   * 取「最外层」而不是「最近的」：播放器的整台 UI 分散在容器的多个子块里
   * （.appmsg_video 只包点赞/关注面板，倍速条和「观看更多」在 .feed-wrapper），
   * 只替换最近的一层仍会漏出大量文案。
   */
  function findCarrier(el, root) {
    var carrier = null;
    var p = el;
    while (p && p !== root && p.nodeType === 1) {
      if (p.matches && p.matches(PLAYER_WRAP_SEL)) carrier = p;
      p = p.parentElement;
    }
    return carrier || el;
  }

  /** 读出一个附件节点能点开的在线地址；不是附件（普通 iframe 等）返回 null */
  function readAttachment(holder, pageUrl) {
    var tag = holder.tagName;

    if (tag === 'VIDEO' || tag === 'AUDIO') {
      var href = firstHttpUrl([
        holder.getAttribute('src'),
        holder.getAttribute('data-src'),
        attrOf(holder.querySelector('source'), 'src')
      ]);
      if (!href) return null;
      return { kind: tag === 'AUDIO' ? '语音' : '视频', source: '', href: href };
    }

    var frame = tag === 'IFRAME' ? holder : holder.querySelector('iframe');

    if (frame) {
      var playUrl = firstHttpUrl([
        attrOf(frame, 'data-src'),
        attrOf(frame, 'src'),
        holder.getAttribute('data-src'),
        holder.getAttribute('src')
      ]);
      var vid = pickVideoId(holder, frame, playUrl);

      // 视频号：分片加密、没有公开可分享地址，只能指回原文
      if (tag === 'MP-COMMON-VIDEOCHANNELS' || /channels|finder/i.test(playUrl)) {
        return { kind: '视频', source: '视频号', href: pageUrl };
      }

      // 腾讯视频：播放页固定是这个形状，vid 拿不到就退回原始 iframe 地址
      if (/v\.qq\.com/i.test(playUrl)) {
        return {
          kind: '视频',
          source: '腾讯视频',
          href: vid ? 'https://v.qq.com/x/page/' + encodeURIComponent(vid) + '.html' : playUrl
        };
      }

      if (!playUrl && !vid) return null;

      // 微信自己的播放器：data-src 就是播放页（readtemplate?pages/video_player_tmpl…），
      // 浏览器里打开能直接播，优先复用；只有拿到 JSON 接口地址时才按 vid 重新拼播放页。
      var isPlayerPage = /video_player_tmpl|action=mpvideo/i.test(playUrl)
        && !/get_mp_video_play_url|f=json/i.test(playUrl);
      var href2 = isPlayerPage ? playUrl : (vid ? buildPlayerUrl(vid) : '');
      if (!href2) return null;
      return { kind: '视频', source: '微信视频', href: href2 };
    }

    // 新版播放器把 <video> 直接渲染进 span.video_iframe 里，没有 iframe
    var media = holder.querySelector('video, audio');
    if (media) return readAttachment(media, pageUrl);

    // 播放器还没渲染出来：容器自己带 vid（<span vid="wxv_…">），按 vid 拼播放页
    var ownVid = pickVideoId(holder, null, holder.getAttribute('src') || holder.getAttribute('data-src') || '');
    if (!ownVid) return null;
    return { kind: '视频', source: '微信视频', href: buildPlayerUrl(ownVid) };
  }

  /** 微信视频播放页（就是文章里 iframe 的原始地址） */
  function buildPlayerUrl(vid) {
    return 'https://mp.weixin.qq.com/mp/readtemplate?t=pages/video_player_tmpl'
      + '&action=mpvideo&auto=0&vid=' + encodeURIComponent(vid);
  }

  function pickVideoId(holder, frame, playUrl) {
    var fromAttr = String(
      holder.getAttribute('data-mpvid') || attrOf(frame, 'data-mpvid') || ''
    ).trim();
    if (fromAttr) return fromAttr;

    var m = String(playUrl || '').match(/[?&]vid=([^&#]+)/);
    if (m) {
      try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
    }
    var m2 = String(playUrl || '').match(/wxv_[A-Za-z0-9_-]{10,}/);
    return m2 ? m2[0] : '';
  }

  function attrOf(el, name) {
    return el ? el.getAttribute(name) : null;
  }

  function firstHttpUrl(list) {
    for (var i = 0; i < list.length; i++) {
      var raw = String(list[i] || '').trim();
      if (!raw) continue;
      var abs = raw.indexOf('//') === 0 ? 'https:' + raw : raw;
      if (/^https?:\/\//i.test(abs)) return abs;
    }
    return '';
  }

  return {
    collect: collect,
    findCarrier: findCarrier,
    readAttachment: readAttachment,
    PLAYER_CHROME_SEL: PLAYER_CHROME_SEL,
    buildPlayerUrl: buildPlayerUrl
  };
})();
