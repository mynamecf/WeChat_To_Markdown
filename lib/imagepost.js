/**
 * lib/imagepost.js —— 「图片消息」（图文 / 小绿书）适配
 *
 * 微信有两套正文模板：
 *   1. 普通图文：所有内容（含图片）都在 <div id="js_content"> 里；
 *   2. 图片消息：<div id="js_content"> 里只有一个 #js_image_content
 *      （<h1> 标题 + <p id="js_image_desc"> 一堆文字），真正的图片在
 *      #js_content **之外**的轮播区 #img_list 里，一张都不在正文容器内。
 *
 * 第二种模板下 content.js 的 ARTICLE_SELECTOR 扫不到任何 <img>，导出就是
 * 「只有文字、0 张图」。这个模块只负责把图片消息补成普通正文的形态：
 *   - 从 #img_list 按轮播顺序取出全部图片，按「文字在前、图在后」插进 clone；
 *   - 删掉图片消息特有的 UI 噪音（重复标题、原文来源行、IP 属地 + 日期）。
 * 插进去的就是普通 <img src>，后续下载 / 命名 / 引用全部复用 content.js
 * 原有链路，下载侧一行都不用改。
 *
 * 图片地址取 .swiper_item[data-src]（原图）：内层 img[src] 是
 * tp=webp&watermark=1 的展示副本（带水印、转成 webp），不如原图。
 * 懒加载只给当前几屏填 src，但 data-src 是全的，纯 DOM 就能拿全。
 *
 * 轮播第 1 项通常是「撑开尺寸的空壳」（无 data-src、只有一张 img[src]），
 * 它的图和真图第 1 张同 path，见 collectUrls 的两遍扫描逻辑。
 */
var WXMD_IMAGEPOST = (function () {
  'use strict';

  /**
   * 图片消息判定锚点：普通图文没有这些节点。
   * id 与 class 都认：同一种模板常有「带 id」和「只剩 class」两版，
   * 只绑 id 的话换个版本就退回 0 张图（与本次要修的老问题一模一样）。
   */
  var DETECT_SEL = [
    '#js_image_content',
    '.image_content',
    '#img_list',
    '.img_swiper_area',
    '.img_swiper_content'
  ].join(',');

  /** 轮播项：每项一张图，DOM 顺序即阅读顺序 */
  var ITEM_SEL = [
    '#img_list .swiper_item',
    '.img_swiper_area .swiper_item',
    '#img_swiper_content .swiper_item',
    '.share_media_swiper_content .swiper_item'
  ].join(',');

  /**
   * 仅供撑开尺寸的空壳容器：里面那个 .swiper_item 没有 data-src，
   * 只有一张 img[src]（懒加载占位/预览），不是正文图。
   */
  var PLACEHOLDER_SEL = '.share_media_swiper_size_placeholder';

  /**
   * 图片消息专属的 UI 噪音。
   * 注意：只在这个模块里删，普通图文一行不动。
   */
  var NOISE_SEL = [
    'h1.rich_media_title',          // 与 #activity-name 重复，YAML 里已有 title
    '#js_origin_source',            // 「原文 <另一篇的标题>」
    '.rich_media_meta_area_extra',  // IP 属地 + 日期
    '#js_ip_wording_wrp',
    '#publish_time',                // YAML 的 published 在 clone 之前就读好了
    '.rich_media_meta_list',
    '.wx_bottom_sponsor_ad_area',
    '.rich_media_tool'
  ].join(',');

  /** HTML 实体与协议相对地址归一 */
  function decodeUrl(raw) {
    var s = String(raw || '').trim();
    if (!s) return '';
    // 属性值里的 & 被转义过，不还原的话下载出来是 404
    s = s.replace(/&amp;/gi, '&').replace(/&#0*38;/g, '&');
    if (s.indexOf('//') === 0) s = 'https:' + s;
    return s;
  }

  /** 去重键：同一张图常带不同 query（wx_fmt / tp / watermark），按 path 比 */
  function keyOf(url) {
    return url.split('#')[0].split('?')[0];
  }

  /**
   * 轮播角标上的「共 N 张」。只在取到的张数对不上时用于告警——
   * 万一以后微信改成「只渲染可视区附近几项」，能立刻发现而不是静默少图。
   */
  function readAnnouncedTotal(pageRoot) {
    var el = pageRoot.querySelector('#img_list_indicator .swiper_tips_right')
      || pageRoot.querySelector('#img_list_indicator');
    if (!el) return 0;

    var nums = String(el.textContent || '').match(/\d{1,4}/g) || [];
    var max = 0;
    for (var i = 0; i < nums.length; i++) {
      var n = parseInt(nums[i], 10);
      if (n > max) max = n;
    }
    return max;
  }

  /**
   * 按轮播顺序取全部图片地址（已去重）。
   *
   * 两遍扫描，先认全部 data-src（原图），再决定哪些项要走 img[src]：
   *   - 有 data-src 的项一律用原图；
   *   - 没有 data-src 的项，只有在其 img[src] 的 path 不属于任何原图时才算「另一张图」。
   * 这条规则是为了挡住轮播里那个「撑开尺寸的空壳项」：它排在第 1 位、没有
   * data-src，只有一张 img[src]，而那张图正是真图第 1 张的展示副本（带
   * usePicPrefetch，path 相同）。旧实现逐项「没有 data-src 就退回 img[src]」，
   * 第 1 张因此取的是副本；一旦微信换成模糊预览图，导出的第一张就是错图。
   */
  function collectUrls(pageRoot) {
    var items = pageRoot.querySelectorAll(ITEM_SEL);

    // 第一遍：原图路径白名单
    var originKeys = {};
    for (var i = 0; i < items.length; i++) {
      var ds = decodeUrl(items[i].getAttribute('data-src'));
      if (/^https?:\/\//i.test(ds)) originKeys[keyOf(ds)] = true;
    }

    // 第二遍：按 DOM 顺序收集
    var urls = [];
    var seen = {};
    for (var j = 0; j < items.length; j++) {
      var el = items[j];
      var raw = el.getAttribute('data-src') || '';

      if (!raw) {
        // 空壳容器整项跳过；其余项退回展示副本，但副本所属原图已在列表里就不要了
        if (el.closest && el.closest(PLACEHOLDER_SEL)) continue;
        var img = el.querySelector('img[src]');
        raw = img ? img.getAttribute('src') : '';
        var probe = decodeUrl(raw);
        if (probe && originKeys[keyOf(probe)]) continue;
      }

      var url = decodeUrl(raw);
      if (!/^https?:\/\//i.test(url)) continue;

      var key = keyOf(url);
      if (seen[key]) continue;
      seen[key] = true;
      urls.push(url);
    }

    return urls;
  }

  /**
   * 把图片消息整理成普通正文形态（就地修改 clone）。
   * @param {Element} clone 正文克隆节点
   * @param {Document|Element} [pageRoot] 原页面，用于取 #img_list（图片在正文外）
   * @param {Function} [log] 调试输出
   * @returns {Number} 补进去的图片张数；不是图片消息时返回 0
   */
  function prepare(clone, pageRoot, log) {
    if (!clone) return 0;

    var doc = pageRoot || clone.ownerDocument
      || (typeof document !== 'undefined' ? document : null);
    if (!doc || typeof doc.querySelector !== 'function') return 0;

    // 判定放在最前面：普通图文直接返回，后面所有改动都不会发生
    if (!doc.querySelector(DETECT_SEL)) return 0;

    var urls = collectUrls(doc);

    // 角标说 15 张、DOM 只给出 8 张 → 明确告警，别让人以为「这篇本来就这么几张图」
    var announced = readAnnouncedTotal(doc);
    if (announced > urls.length && typeof console !== 'undefined' && console.warn) {
      console.warn('[wx-md] 图片消息共 ' + announced + ' 张，本次只取到 ' + urls.length
        + ' 张（轮播未渲染完整）');
    }

    var appended = 0;

    if (urls.length) {
      var ownerDoc = clone.ownerDocument || doc;
      var holder = ownerDoc.createElement('div');

      // 正文里已经有的图不再重复插：个别模板会把首图也塞进 #js_image_content，
      // 那样轮播补一遍就成了两张（同一张图在 md 里出现两次）。
      var inBody = {};
      var bodyImgs = clone.querySelectorAll('img');
      for (var b = 0; b < bodyImgs.length; b++) {
        var bs = decodeUrl(bodyImgs[b].getAttribute('data-src') || bodyImgs[b].getAttribute('src'));
        if (bs) inBody[keyOf(bs)] = true;
      }

      for (var i = 0; i < urls.length; i++) {
        if (inBody[keyOf(urls[i])]) continue;
        var img = ownerDoc.createElement('img');
        img.setAttribute('src', urls[i]);
        holder.appendChild(img);
        appended++;
      }

      // 文字在前、图在后：插在描述段落之后（没有描述段就挂在 #js_image_content 后面）
      if (appended) {
        var desc = clone.querySelector('#js_image_desc');
        var anchor = desc || clone.querySelector('#js_image_content');
        if (anchor && anchor.parentNode) {
          anchor.parentNode.insertBefore(holder, anchor.nextSibling);
        } else {
          clone.appendChild(holder);
        }
      }
    }

    // UI 噪音：整块删。删之前确认里面没有正文段落——
    // 个别旧模板会把描述塞进 meta 容器，那种情况留着不动。
    //
    // 只在「确认是图片消息」时清：DETECT_SEL 放宽到 class 之后，普通文章里万一
    // 也有个 .image_content 会让判定命中，但那种页面没有 #js_image_content /
    // #js_image_desc，清噪音就是误伤——没图也没描述段落就什么都不做。
    var looksLikePost = urls.length > 0
      || !!clone.querySelector('#js_image_content, #js_image_desc');
    if (looksLikePost) {
      var noisy = clone.querySelectorAll(NOISE_SEL);
      for (var k = 0; k < noisy.length; k++) {
        var el = noisy[k];
        if (el.querySelector && el.querySelector('#js_image_desc')) continue;
        if (el.parentNode) el.parentNode.removeChild(el);
      }
    }

    if (typeof log === 'function') {
      log('image post:', appended + '/' + urls.length);
    }
    return appended;
  }

  return {
    // 唯一入口
    prepare: prepare,
    // 单独暴露便于排查 / 单测
    collectUrls: collectUrls,
    DETECT_SEL: DETECT_SEL
  };
})();
