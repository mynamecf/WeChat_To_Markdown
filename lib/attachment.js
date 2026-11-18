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
    // 视频号卡片（图文里嵌别人发的视频号视频）。class 是 channels_iframe +
    // videosnap_video_iframe，不是 .video_iframe——CSS class 选择器按整 token 匹配，
    // 少一个前缀就完全不命中，这正是这类视频被漏掉的原因。
    '.channels_iframe_wrp',
    '.channels_iframe',
    '.videosnap_video_iframe',
    'mp-common-videosnap',
    'mp-common-videoplayer',
    'mp-common-videobox',
    'mp-common-videosnippet',
    'mp-common-videochannels',
    '.video_iframe',
    '[id^="js_mp_video_container"]',
    '.appmsg_video',
    '[id^="js_mpvedio_wrapper"]'
  ].join(',');

  /**
   * 视频号卡片本体。这类卡片在 shadow DOM 里只有播放按钮、昵称、点赞数，
   * 没有 <video>，也没有 web 播放页（真实流要调 mp/appmsg_video_snap，
   * 带微信登录态且分片加密），所以只能指回原文。
   */
  var SNAP_SEL = 'mp-common-videosnap, mp-common-videoplayer, mp-common-videobox';

  /** 播放器残留外壳：读不出地址时整块删掉，否则 UI 文案会被当正文 */
  var PLAYER_CHROME_SEL = [
    '.channels_iframe_wrp',
    '.channels_iframe',
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
  var MEDIA_SEL = 'video, audio, iframe, mp-common-videosnap, mp-common-videoplayer, '
    + 'mp-common-videobox, mp-common-videosnippet, mp-common-videochannels';

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
      found.push({ carrier: carrier, kind: info.kind, source: info.source, href: info.href, snap: !!info.snap });
    }

    // 容器互相嵌套时（外层 .video_iframe 里又套了个自定义标签）只保留最外层：
    // 外层被整体替换后内层节点已分离，留着会占掉一个编号却写不出链接
    found = found.filter(function (item) {
      return !found.some(function (other) {
        return other.carrier !== item.carrier && other.carrier.contains(item.carrier);
      });
    });

    // 视频号卡片的定位序号：按最终收录顺序、不分 video / live 一起数，
    // 扩展侧（floating.js）用同一个选择器取第 N 个，两边必须同序，
    // 所以这里必须放在上面的嵌套去重之后，否则会错位。
    var snapNo = 0;
    found.forEach(function (item) {
      if (!item.snap) return;
      snapNo++;
      item.href = appendQuery(item.href, 'wxmd_video', snapNo);
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

    // 视频号卡片优先：它既没有 iframe 也没有 <video>，走下面的分支只会返回 null。
    // carrier 可能是外层的 .channels_iframe_wrp，所以这里向下找一次本体。
    var snap = (holder.matches && holder.matches(SNAP_SEL))
      ? holder
      : (holder.querySelector ? holder.querySelector(SNAP_SEL) : null);
    if (snap) return readVideosnap(snap, pageUrl);

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

  /**
   * 视频号卡片：只能给「原文 + 定位参数」。
   *
   * data-url 看着像视频直链（findermp.video.qq.com/.../stodownload），实测返回的是
   * 540×720 封面 JPEG，换 UA / 加 Referer 都不变；页面里也没有 channels.weixin.qq.com
   * 或 weixin:// 这类可分享地址。所以不假装给直链，老老实实指回原文。
   *
   * 定位走 query 参数而不是 #hash / #:~:text=：微信页面在加载后约 300ms 内会
   * replaceState 把 hash 抹掉（实测 400ms 时 location.href 已经没有 fragment、
   * scrollY 仍是 0），而 Chrome 处理 text fragment 比这更晚，首次打开必然不跳。
   * query 参数实测一直保留，改由扩展在页面就绪后自己滚过去。
   */
  function readVideosnap(holder, pageUrl) {
    var type = String(holder.getAttribute('data-type') || 'video').toLowerCase();
    var plugin = String(holder.getAttribute('data-pluginname') || '').toLowerCase();
    var nick = String(holder.getAttribute('data-nickname') || '').trim();
    var isLive = type === 'live' || plugin.indexOf('live') >= 0;

    var source = isLive ? '视频号直播' : '视频号';
    if (nick) source = source + ' · ' + nick;

    return {
      kind: isLive ? '直播' : '视频',
      source: source,
      href: pageUrl,
      // 序号由 collect 在去重之后统一赋，见 assign snap 那一段
      snap: true
    };
  }

  /**
   * 在 URL 上追加参数，保留 #wechat_redirect 这类原有 hash（微信靠它防重复跳转）。
   * 没装扩展时这个参数完全无害：微信照常打开文章，只是不做定位。
   */
  function appendQuery(url, key, value) {
    var s = String(url || '');
    if (!s) return s;
    var at = s.indexOf('#');
    var hash = at >= 0 ? s.slice(at) : '';
    var body = at >= 0 ? s.slice(0, at) : s;
    var sep = body.indexOf('?') >= 0 ? '&' : '?';
    return body + sep + key + '=' + encodeURIComponent(String(value)) + hash;
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
    appendQuery: appendQuery,
    SNAP_SEL: SNAP_SEL,
    PLAYER_CHROME_SEL: PLAYER_CHROME_SEL,
    buildPlayerUrl: buildPlayerUrl
  };
})();
