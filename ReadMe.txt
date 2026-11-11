
【微信公众号文章转 Markdown 浏览器插件】

这个插件的工作流程是：
    Content Script（内容脚本）：注入到微信文章页面，滚动加载所有懒加载图片，提取标题、正文 HTML 和图片地址。
    Background Service Worker（后台脚本）：接收内容脚本的数据，下载所有图片为本地文件，用 Turndown 将 HTML 转为 Markdown，替换图片路径为本地相对路径，最后通过 chrome.downloads 保存 Markdown 文件和图片。
    Popup（弹窗）：用户点击扩展图标后，触发整个流程

整体项目结构如下：
wechat-to-md/
├── manifest.json：这是扩展的配置文件，声明了权限、入口和资源。
├── content.js：内容脚本。这个脚本会被注入到微信文章页面，负责提取文章内容。
├── background.js：后台核心逻辑。这是整个插件的核心，负责图片下载、Markdown 转换和文件保存。
├── popup.html：弹窗界面
├── popup.js：弹窗逻辑
├── lib/
│   ├── turndown.js
│   └── turndown-plugin-gfm.js
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png


<script src="https://unpkg.com/turndown/dist/turndown.js"></script>
<script src="https://unpkg.com/turndown-plugin-gfm/dist/turndown-plugin-gfm.js"></script>

验证链接：
https://mp.weixin.qq.com/s/0IoSNvEikXsPcXTWbvQejw
https://mp.weixin.qq.com/s/f9Ji0f-GdCEVoY1M6jj7Ig
https://mp.weixin.qq.com/s/0NRNBjfF_6Vh5Muht9y8pA

更新记录：
A.初始化
B.文件名称加日期前缀
C.图片webp格式优化
D.代码快txt识别
E.处理小问题，部分txt识别有误
F.图片换行问题，引用块换行问题
G.设置：附件下载/附件链接
H.附件下载到本地，处理本地链接规则
I.增加标题的处理规则
J.尽量支持Obsidian所支持的token。同时调整详细配置页面的显示样式。
K.一天中，多篇文章导出问题。新增以下功能：
逐篇归档：每篇文章单独一个文件夹，附件随文归档。
平铺归档：所有文章与附件置于同一文件夹，文章平级，附件混排。
L.详细配置选择“逐篇归档”或“平铺归档”时，插件弹窗页面下载本地要同步显示。
M.详细配置页面的可用变量可折叠，默认隐藏。增加插件悬浮功能。
N.悬浮球长按可以拖动位置。悬浮球样式更改-原型改为圆角矩形。
O.快捷键保存/下载文章。
P.workbuddy优化处理。
Q.代码审查修复（v16.1.0）：
1.修复 div/span 包裹图片时被误判为空节点、导致图片在 Markdown 里丢失的问题。
2.修复伪代码块内 <br> 换行被吃掉、多行代码粘成一行的问题。
3.图片被自动重命名（xxx (1).webp）后，Markdown 中的链接同步更新，不再断链。
4.路径净化补齐 Windows 规则（结尾点/空格、CON/NUL 等保留名），避免下载失败。
5.浮窗改用 closed Shadow DOM，页面脚本无法再读取或模拟点击浮窗按钮。
6.不再下载指向内网/本机地址的图片（防止恶意文章借扩展探测内网），第三方图床不受影响。
7.页面域名判断改为精确匹配 hostname，不再被相似域名绕过。
8.浮窗临时选项注入失败时自动清理，避免下一次导出沿用上一次的选择。
9.命名规则抽到 lib/naming.js，配置页预览与实际落盘的文件名完全一致。
10.性能：引用块/代码块识别改用属性选择器预筛；Markdown 转换省去一次字符串序列化往返。
11.配置页新增「导出位置说明」：明确导出目录固定为浏览器下载目录（扩展无法指定绝对路径），并说明如何用模板前缀把文件放进子文件夹。
R.配置页直接显示「当前下载目录」的真实路径（v16.2.0）：
1.Chrome 没有提供查询默认下载目录的接口，这里是拿上一次导出的真实落盘绝对路径、减去扩展传进去的相对路径，反推出下载根目录。
2.三种状态分开显示，不会张冠李戴：①还没导出过 → 提示「尚未导出过」；②反推成功 → 显示真实路径，点一下可整段选中复制；③反推不出来 → 提示「无法确定」，并指出多半是开了 Chrome 的「下载前询问每个文件的保存位置」，宁缺勿错。
3.路径只存在本机扩展存储（storage.local）里，不参与浏览器账号同步、不联网外传。删除扩展时随之清除。
4.说明文字明确：想改这个目录，只能去 Chrome「设置 → 下载内容 → 位置」修改；扩展无权读写该设置。改完再导出一次，配置页这行会自动更新。
S.异常兜底补强（v16.3.0）：
1.正文提取的依赖检查收敛到一处：lib/naming.js 缺失属于不可降级的硬依赖，直接返回明确错误（告知是哪个模块、该重新加载扩展）；lib/defaults.js 缺失则降级为内置的简化内网地址判断，并打一条告警。
2.修掉一个静默故障：之前若 lib/defaults.js 未注入，WXMD_isPrivateHost 未定义会抛 ReferenceError，被图片判断的 catch 吞掉，导致整篇文章的图片全部退化成在线链接且无任何提示。现在兜底实现与权威规则逐条一致（15 个主机名用例验证等价）。
3.弹窗与浮窗的导出按钮加了超时兜底：后台被浏览器强杀或卡死不返回时，消息通道可能一直悬空，按钮会永久 disabled。现在超时后放开按钮并如实提示「超时：后台可能已中断，请先检查下载目录再重试」——不谎报成功，也不中断后台可能仍在进行的任务。
4.弹窗的兜底时长按图片数量放宽（60s + 每图 1.5s，上限 10 分钟），浮窗固定 5 分钟。
5.配置页「恢复默认」的 ✓ 已恢复（1.4s 瞬时反馈）现在会在保存或编辑输入时立即收回，不再和保存按钮的 ✓ 已保存 同时挂着。
T.官网入口 + 图片引用路径可配（v16.4.0）：
1.弹窗底部、配置页顶栏新增「官网」「问题反馈」两个入口。地址只在 lib/defaults.js 的 WXMD_LINKS 里维护一处，改完重新加载扩展，两个界面同时生效；留空字符串则对应链接自动隐藏，不会留下点不开的死链。
2.点击链接统一走 chrome.tabs.create 新开标签页。用 <a target="_blank"> 在弹窗里会优先就地导航，弹窗被网页顶掉后用户就回不去了。
3.图片在 Markdown 里的引用路径新增四种形态，配置页「Markdown 中的图片引用路径」里点选即可（即时生效，不用点保存）：
   ①相对库内模糊路径  2026/11/09/a.png                 无前缀，交给笔记软件自行解析（Obsidian 最短路径习惯）
   ②相对当前笔记      ./2026/11/09/a.png               以 .md 所在文件夹为基准（默认值，与旧版行为一致）
   ③相对笔记上一级    ../2026/11/09/a.png              适合笔记在子目录、附件在上一级的库结构
   ④相对库内绝对路径  /20261110_标题/2026/11/09/a.png  以库根为基准，链接里带上 .md 所在的那层文件夹
4.四种模式只改变链接的写法，不影响图片实际落盘位置；切换时不会重新下载、也不会动已有文件。
5.拼路径的规则收敛在 lib/naming.js 的 buildImageRef，background.js（真实写盘）和配置页预览调用同一个函数，预览显示什么、导出的 md 里就是什么。
6.配置页预览框新增「Markdown 中写作」一行，与上方目录树对照着看，一眼能确认链接对不对。
U.配置页两处说明收起 + 示例路径释疑（v16.5.0）：
1.「导出位置说明」改为可折叠，默认收起，与「可用变量」一致。首屏不再被大段目录说明占掉，需要时点标题展开。折叠状态不写入存储，每次打开都是收起的。
2.两处折叠收敛成同一段逻辑（options.js），新增折叠区块只需在数组里补一对 id，不用再抄一遍事件绑定。
3.图片引用路径的示例按默认模板重写，并补一行来历说明：日期段来自「图片保存目录」，「相对库内绝对路径」多出的第一段来自「导出的文件夹及 Markdown 名称」。改模板后示例仅供参考，真实结果看下方预览。
4.「导出位置说明」标题右侧加「浏览器下载目录」小标，收起时仍能一眼看出导出位置的性质。
V.库内绝对路径加「库内前缀」（v16.6.0）：
1.修复一个必然断链的场景：导出到「下载」，再把文章文件夹搬进笔记库的某个子目录后，/20261110_标题/2026/11/09/a.png 仍然从库根去找 20261110_标题，而它实际在 库/微信/20261110_标题 下，Obsidian 和 Typora 都找不到文件。
2.新增 storage 键 vaultPrefix（对应配置页「库内前缀」输入框），只在「相对库内绝对路径」下出现，填「下载目录对应库里的哪一层」：填 微信 → /微信/20261110_标题/2026/11/09/a.png。留空即旧行为（下载目录就是库根）。
3.前缀的清洗（反斜杠转 /、去掉首尾与重复斜杠、空格转 %20）放在 lib/naming.js 的 buildImageRef 里，预览与真实导出共用；空格必须编码，否则 Markdown 会把后面整段当成 title，图片直接失效。
4.前缀只影响 vault 模式，另外三种的输出与旧版逐字节一致（已用四种输入对照验证）。
5.Typora 把 / 当成盘符根，库内绝对路径在 Typora 里天然不可用，这不是能靠改路径修好的；用 Typora 请选「相对当前笔记」，随手搬动文件夹也不会断链。
6.「恢复默认」会把库内前缀一并清空。
W.引用路径收敛为三选一 + 自定义前缀（v16.7.0）：
1.去掉「相对笔记上一级」「相对库内绝对路径」两个固定选项，合并成「自定义前缀」：前缀原样拼在「图片目录/文件名」前面——想上一级写 ../，想库内绝对路径写 /微信/{{noteFolder}}/。
2.{{noteFolder}} 会替换成 .md 所在文件夹（即「导出的文件夹及 Markdown 名称」的结果），所以库内绝对路径不用再单独维护一个输入框，v16.6.0 引入的 vaultPrefix 键随之移除。
3.旧配置自动迁移，不用重选：parent → custom(../)，vault → custom(/{{noteFolder}}/)，若存过 vaultPrefix 则拼进中间（/微信/{{noteFolder}}/）。迁移只在读取时生效，点保存才写回存储。
4.前缀统一清洗：反斜杠转 /、合并重复斜杠、空格编码成 %20（Markdown 链接里的裸空格会把后面整段截成 title），结尾缺斜杠自动补；前缀留空等同「相对库内模糊路径」。
5.自定义前缀输入框只在选中该模式、且为本地下载时出现，不会和在线模式互相干扰。
6.三种模式的路径主体仍是「相对 .md 所在文件夹」，改模式只改前缀，不动图片实际落盘位置。
X.引用路径示例改为实时计算 + 自定义前缀收进阴影块（v16.8.0）：
1.「相对库内模糊路径」「相对当前笔记」两格的示例不再是写死的 2026/11/09/a.png，改为用当前模板实时算出——显示的就是「Markdown 中写作」括号里的那段（不带 ![]()），换模板、改日期后两边永远一致，不会再出现示例说 11/09、预览说 11/10 的情况。
2.「自定义前缀」压缩成一个阴影块：标题与小圆点在左、输入框在右，同一行放下，省掉原来「按钮占一行 + 输入框再占一行」的高度；块内第二行实时显示该前缀拼出来的路径。
3.输入框不再整块隐藏，未选中时只是灰底空心点（点输入框即自动切到自定义前缀，不用先点标题）；在线模式下整块变淡并提示「在线模式不适用」。
4.「/微信/{{noteFolder}}/」的说明挪进第二个灰底说明块，与「示例来源」并排成两段，不再是裸露的小字。
5.「最终路径预览」改为显示 3 张图片（默认模板下为 _1/_2/_3）；图片命名模板不含 {{index1}} 时，按 Chrome 撞名规则补「 (1)」「 (2)」，与真实落盘一致。
6.「Markdown 中写作」标注为「第一张」，避免和目录树里的三张对不上。
Y.引用路径统一单选点 + 弹窗链接行重做（v16.9.0）：
1.「相对库内模糊路径」「相对当前笔记」前面补上单选圆点，与「自定义前缀」一致，三格现在都是「圆点 + 标题 + 示例路径」。
2.「自定义前缀」块里的「写作」二字去掉，路径行改为和另外两格完全相同的样式（11px 等宽、灰色、选中变绿）。
3.「Markdown 中写作（第一张）」从预览框移到「Markdown 中的图片引用路径」标题正下方，先看当前输出，再看选项；预览框只留目录树。
4.删掉「示例来源」说明块，「自定义前缀」的说明并进自定义块的虚线下方，独立说明块全部取消。
5.弹窗页底部「官网 · 问题反馈」重做：上方加浅色分隔线、图标 + 12px 文字、竖线分隔、悬停浅绿背景，不再是 11px 灰字；点击仍走 chrome.tabs.create。
6.打开链接逻辑加固：chrome.tabs.create 返回的 Promise 失败时退回 window.open；两条路都失败才走 <a> 默认跳转。
7.提醒：WXMD_LINKS 里仍是占位地址（github.com/yourname/...），点开会是 404，需替换成真实地址；改完必须在 chrome://extensions 重新加载扩展，弹窗页才会更新。
Z.「自定义前缀」整块可点（v16.9.1）：
1.修一个手感问题：自定义前缀块原来只有「圆点 + 标题」那一小行是按钮，点到块内留白、示例路径、说明文字都没反应，看着像「有时选不中」。现在整块都可点，圆点、标题、留白、示例路径、说明文字点哪儿都能选中。
2.输入框除外（点它本来就是进输入框），但输入框也补了 click 监听：已聚焦状态下再点一次，focus 不会再触发，光靠 focus 会漏掉这一次切换。
3.块加了手型光标和悬停描边（与另外两格的悬停反馈一致），能点的范围一眼可辨；输入框内部仍是文本光标。
4.三个选项的点击收敛到同一个 selectImagePathMode()，重复点选同一项直接返回，不会重复写 storage、也不会让预览闪烁。
AA.配置分组化 + 链接调整（v16.10.0）：
1.「逐篇归档」下的三项（导出的文件夹及 Markdown 名称 / 图片保存目录 / 图片文件命名）现在和「平铺归档」一样包在同一个浅色虚线块里，两种归档方式的分区形状一致；块内第一项的标题加粗，用来当块的标题。
2.「Markdown 中的图片引用路径」独立成块，与上面的归档字段块分开，不再和它们挤在一起。
3.去掉三格选项下的完整示例路径（与上方「Markdown 中写作（第一张）」重复）：改成「无前缀」「./ 开头」两个短标记，完整路径只在「Markdown 中写作」那一行出现；自定义块里的示例路径行同步删除。
4.「恢复默认」时自定义前缀回到 /微信/{{noteFolder}}/（库内绝对路径写法），不再是空串；该默认值写在 lib/defaults.js 的 imageRefPrefix。
5.配置页顶栏「官网 / 问题反馈」稍微加深（#4b5563 + 500 字重，12.5px），仍保持低调。
6.弹窗底部「官网 · 问题反馈」压扁：去掉分隔线、链接内边距收到 1px 7px，与「详细配置」的间距缩小，弹窗不再被这一行撑高。
7.页内浮窗（floating.js）新增同一行「官网 · 问题反馈」：面板底部、「详细配置」下方，同样只占一条窄行；地址仍只写在 lib/defaults.js 的 WXMD_LINKS，manifest 里给浮窗多注入一份 lib/defaults.js。
8.浮窗里两个地址都留空时整行不占位，不会留下一条空行。
AB.引用配置按归档方式分开 + 两处间距对齐（v16.11.0）：
1.逐篇归档与平铺归档的「自定义前缀」彻底分开存：perArticleImageRefPrefix / sharedImageRefPrefix（模式同理 perArticleImagePathMode / sharedImagePathMode）。在逐篇里点「恢复默认」不会再顺手把平铺的前缀一起改掉；切到平铺看到的是平铺自己那份，切回来逐篇还是原来的值。
2.旧的单份配置（imagePathMode / imageRefPrefix）继续作为迁移兜底：分档字段没写过时按旧值走，老用户升级后不用重选；保存时才把两份一起写回，旧字段同步成当前归档方式的值，供旧版本与兜底代码读取。
3.读取收敛到 lib/naming.js 的 resolveImageRefForFolder(cfg, folderMode)，content.js 按本次归档方式取用，background.js 仍拿 content 传下来的 mode/prefix 拼路径，预览与真实导出不会分叉。
4.在线模式（父卡片未选中）时，引用路径的选中项也降级成中性色：白底、灰描边、深灰标题、浅绿圆点，与「逐篇归档 / 平铺归档」未生效时的样式保持一致——绿色只留给真正生效的那一套。
5.浮窗底部「官网 · 问题反馈」上下留白对齐：「详细配置」到这一行 6px、这一行到面板底边也 6px（原来下方 12px、上方 3px，一宽一窄）。
AC.视频/语音只留在线链接，不再下载本体（v16.12.0）：
1.回退视频下载：background.js、options.html、options.js、lib/defaults.js 全部回到 v16.11.0 的状态——不再有「正文视频」配置块、VID_ 文件命名模板、videoMode / videoFilename 存储键，background 里也没有下载视频、校验体积、重试降档那套逻辑。
2.附件只下载图片：图片识别、防盗链跳过、内网地址拦截、引用路径模式、落盘与 {{IMG_n}} 替换全部不变。
3.视频 / 语音直接在正文原位置写在线链接，不再产生任何本附件文件：
   [视频 1（微信视频）](https://mp.weixin.qq.com/mp/readtemplate?t=pages/video_player_tmpl&action=mpvideo&auto=0&vid=wxv_xxx)
   [视频 2（腾讯视频）](https://v.qq.com/x/page/e0012abcd34.html)
   [视频 3（视频号）](文章原地址)
   [语音](https://res.wx.qq.com/voice/xxx.mp3)
4.地址来源：微信播放器 iframe / mp-common-videosnippet 复用 iframe 的 data-src 播放页（浏览器打开就能播），拿不到时按 vid 重拼播放页；腾讯视频取 vid 拼 v.qq.com/x/page/<vid>.html；视频号内容分片加密、没有公开可分享地址，指回原文；<video src/data-src>/<source> 直链原样使用（http 自动升为 https，否则 qpic 必 403）。
5.编号按类别各算一套（视频 1/2/3、语音独立），同一段视频被「自定义标签 + 内层 iframe」命中两次时按最外层载体去重，不会跳号、也不会留下指向已分离节点的空洞。
6.为什么退回：视频直链带 auth_key 签名会过期，mpvideo.qpic.cn 偶发 403 且与 Referer 无关，视频号拿不到文件——下载下来要么是坏文件要么很快失效，md 里留一个点不开的本地路径比留链接更糟。
7.附件占位改在图片统计之前处理：播放器里常包着封面图，外层换成链接后那张图不在正文里了，先换掉可避免「下载了一张没人引用的封面图」。
8.读不出地址的播放器残留节点（含普通地图/广告 iframe）仍然清掉，不会把播放器 DOM 当正文输出。
9.实测：合成页 8 种形态（裸 iframe / 自定义标签套 iframe / 腾讯视频 / 视频号 / 直链 video / 只有 data-src / source 子节点 / 自定义标签里直接放 video）全部产出正确链接，空 data-src 与普通 iframe 被清掉；真实文章 https://mp.weixin.qq.com/s/NDNH_26mMGSFDl8C3ARirg 输出 10 条视频链接（9 个不同 vid，原文重复引用同一段视频各写一条），3 张图片占位 0/1/2 连续，md 内无 iframe/video 残留。
AD.代码块适配：整理编辑器导出的 <pre> 结构（v16.13.0）：
1.症状：mdnice 这类编辑器导出的代码块结构是 <pre><span 工具栏/><code><span>行1</span><span><br></span><span>行2</span>…</code></pre>。pre 有两个直接子元素（工具栏 span + code），isRealCodeBlock 判为 false，被 unwrapFakePre 当成「伪 pre」拆成 div；代码于是退化成行内 `code`——整段粘成一行、没有围栏、缩进变成 &nbsp; 字面量、换行全丢。
2.修法：新增 normalizeEditorPres()，必须在 unwrapFakePre 之前跑。它把这类 pre 整理成标准 <pre><code>：删掉工具栏/背景图等装饰节点，只留 code 一个子节点，让后续通用围栏逻辑接管。
3.新增 extractCodeLines()：把 code 内部按结构还原成一行一条——<br> 与块级元素（p/div/section/li/tr/h1-h6/blockquote）都算换行，\u00a0（&nbsp;）还原成普通空格，行尾空白去掉，中间空行保留（代码里的空行有意义），首尾空行去掉。
4.安全边界：只处理「code 是 pre 的直接子节点」且「同级没有带文字的子节点」的 pre。更深嵌套（pre > p > code）或「说明文字 + code」的写法一律跳过，退给原有逻辑，避免把正文一起删掉。
5.关键字粘连修复：这类导出会把保留字之间的空格吃掉（publicclass / publicinterface / XxxPostProcessorimplements），按「保留字 + 保留字（class/interface/enum/void）」和「字母 + implements/extends + 空格」两种组合补回空格；不碰「关键字 + 标识符」，staticMap、publicKey 这类正常变量名不受影响。
6.txt 式代码块（等宽 <p> 成组那条路径）完全保留，只在行内也套了同一个粘连修复，两种编辑器风格都能处理。
7.实测：https://mp.weixin.qq.com/s/uN8Npn8wwSCgwiGcieURZA 修复前 0 个围栏、代码全部退化成行内反引号；修复后 19 个代码块全部标准围栏，缩进 4 空格、空行保留、注解与保留字分行正确。回归：https://mp.weixin.qq.com/s/0IoSNvEikXsPcXTWbvQejw 3 块、https://mp.weixin.qq.com/s/f9Ji0f-GdCEVoY1M6jj7Ig 2 块，输出的正文/图片/视频链接与改动前一致。
8.已知限制：源数据里已经丢掉的空白补不回来——例如注解紧贴保留字（@RestControllerAdvicepublic）只能按保留字组合补一部分，多出来的空白也无法还原成原始列宽。
9.工具栏文案兼容：「复制代码 / 复制 / Copy」这类按钮文案直接丢弃；写成语言名（Java / Python / bash / c++…）时顺手当围栏语言（```java），txt / text / plain / code 按无语言处理，与等宽 <p> 路径的规则一致；出现其它文字就判定「这里混了正文」，整个 pre 不做整理，一个字都不删。
10.合成用例（7 种）全部符合预期：工具栏只有背景图 / 写着「复制代码」/ 写着「Java」（出 ```java）/ 写着「txt」（出无语言围栏）/ 同级带正文文字（跳过且正文保留）/ code 不是 pre 直接子节点（跳过）/ 空行与 4 空格缩进保留。
AE.代码块逻辑抽成独立模块 lib/codeblock.js（v16.14.0）：
1.为什么拆：代码块这块原本横跨四件事——伪 pre 判定与拆分、编辑器导出结构归一、按行还原（br / &nbsp; / 块级换行）、关键字粘连修复；再加上「等宽 <p> 成组」这条老路径，一共约 270 行混在 content.js 里，和附件、引用块、模板那些逻辑缠在一起，改一处要来回滚屏找。
2.拆分后位置（行号为 v16.14.0 状态，content.js 由 817 行降到 545 行）：
   lib/codeblock.js  40 行  normalizeCodeBlocks —— 唯一入口，内部先 normalizeEditorPres 再 unwrapFakePre，然后走「等宽 <p> 成组」路径
   lib/codeblock.js 160 行  isRealCodeBlock —— 判断 pre 是不是真代码块（唯一子节点是 code）
   lib/codeblock.js 186 行  normalizeEditorPres —— mdnice 这类「工具栏 span + code」结构归一成标准 <pre><code>
   lib/codeblock.js 234 行  extractCodeLines —— br / 块级元素换行、&nbsp; 还原、行尾 trim、中间空行保留
   lib/codeblock.js 280 行  repairGluedKeywords —— publicclass / XxxImplements 这类粘连补空格
   lib/codeblock.js 291 行  unwrapFakePre —— 伪 pre 拆回 div（逆序遍历，无需多轮扫描）
   lib/codeblock.js 307 行  analyzeHeader —— 等宽 <p> 代码块上方的语言标签条
   content.js       369 行  调用点（WXMD_CODE.normalizeCodeBlocks(clone, LOG)）
   content.js       506 行  只留一段说明注释，指向 lib/codeblock.js
   拆分前的位置（回溯旧代码/diff 用）：content.js 499-748 行（normalizeCodeBlocks 501、isRealCodeBlock 611、normalizeEditorPres 637、extractCodeLines 683、repairGluedKeywords 729、unwrapFakePre 740）+ 785-808 行（analyzeHeader）。
3.注入位置：background.js 的 executeScript files 与 popup.js 的 INJECT_FILES 都在 content.js 之前加了 'lib/codeblock.js'；模块用 var 挂 WXMD_CODE，与 lib/naming.js 的 WXMD_NAMING 同一套写法，多文件注入共享同一个 isolated world 全局。
4.依赖处理：模块不读闭包变量——日志由调用方传入（log 参数，缺省不打印），元素创建改用 root.ownerDocument，模块内部没有对 content.js 的隐式依赖，可以单独拿出测试。
5.降级策略：这个模块缺失不阻断导出（代码块会退化成行内 code、整段粘一行），content.js 会 console.error('[wx-md] lib/codeblock.js 未加载…') 明确报出来；与命名模块不同，不直接 return 失败，避免一个排版增强项把整篇文章卡死。
6.调试/单测：除入口外，isRealCodeBlock / normalizeEditorPres / extractCodeLines / repairGluedKeywords / unwrapFakePre / analyzeHeader 都从 WXMD_CODE 上暴露了，可以在页面 console 里对某个 pre 单独跑，不必整篇导出。
7.回归结果（与拆分前逐项一致）：目标文章 19 个代码块、缩进 4 空格 122 行、围栏内 &nbsp; 0 处、无关键字粘连；0IoSNvEikXsPcXTWbvQejw 3 块、f9Ji0f-GdCEVoY1M6jj7Ig 2 块；视频文章 10 条附件链接、合成夹具 9 条链接；7 种工具栏/嵌套用例全部符合预期；--pack-extension 通过。
