
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
AF.列表层级与段落换行修复（v16.15.0）：
1.症状一：https://mp.weixin.qq.com/s/uN8Npn8wwSCgwiGcieURZA 开头目录树全平铺，子项没有缩进。
   根因：排版器把子列表直接挂在父 <ul> 下，而不是包进上一个 <li>：
     <ul><li>简单使用</li><ul><li>引入依赖</li>…</ul></ul>
   Turndown 只认「<li> 内部的嵌套列表」（rules.listItem 靠 li 的深度缩进），这种结构里子列表是 ul 的兄弟节点，于是所有子项拍平成一级。
   修法：新增 normalizeNestedLists()（content.js 573 行，调用点 378 行），在 Turndown 之前把这类子列表挂回前一个 <li> 末尾；只认「前面紧挨着 li」的情况，中间夹了有文字的其它节点就保持原样，宁可平铺也不挂错父项。
   效果：目录变成「简单使用 / 进阶使用 / 实现原理」三项，各自带 4 空格缩进的子项。
2.症状二：https://mp.weixin.qq.com/s/2cyPTZoHMrYNR29Lgy75ww 图片下面的图注和正文粘成一行（「图｜9to5Mac分析师郭明錤则从供应链…」），一部分图片后面的内容没有换行。
   根因：这篇正文段落是 <section><span>文字</span></section>，里面没有 <p>；而 wechatSection 规则原来是「除 blockquote 外一律原样返回」，不给块级空行 → 相邻 section 的文本直接拼接。全篇其实都在粘连，只是图片/标题后面的位置最显眼。
   修法：wechatSection 规则改为按内容判定（content.js 402-417 行）——只含行内内容（span/a/strong/em/br/img 等）的叶子 section 当段落处理，前后补空行；含块级子元素（p/div/section/ul/table/pre/blockquote/h1-h6/figure 等，清单见 BLOCK_KID_RE）的仍视为布局容器，交给内层元素自己处理。
3.列表项里的 section 不加空行（node.closest('li') 直接返回 content）：否则每个目录项都会被撑开，紧凑列表会变成松散列表。
4.blockquote 内的行为保持原样（仍然补空行），避免引用块里多行被合成一行。
5.顺手清掉「整行只有空格」的残留（content.js 469 行）：空段落里的 <br> 会输出 "  \n"，在图片和正文之间留下一行空白。只删整行空白，不动行尾硬换行（「文字 + 两空格 + 换行」仍然保留）。
6.实测：live3 那篇 19 张图、13 条图注全部独立成段，正文 40 个 section 与浏览器里的视觉间距（26px / 图注后 16px）一一对应，无粘连；live 那篇 19 个代码块、4 处缩进层级正常；live1 3 块 / live2 2 块、视频文章 10 条附件链接、合成夹具 9 条链接均不变；四篇的纯空白行由 4~9 行降到 0；--pack-extension 通过。
AG.伪标题兼容：新增 lib/compat.js 特殊兼容层（v16.16.0）：
1.症状：https://mp.weixin.qq.com/s/jV0gm4Qmv8M2JxXQ0NsEpA 里的「一、背景」「三、Why Zvec?」「3.1 开箱即用：…」这些小节标题导出后全是普通段落，只有「3.1 …」因为原文用了 <strong> 变成一行加粗文字，层级完全丢失。
2.根因：这些标题没有用 <h1>~<h6>，而是靠样式伪装：
   一级：<section style="display:inline-block;font-size:17px;color:rgb(255,129,36);border-bottom:5px solid rgb(255,129,36)"><p><span>一、背景</span></p></section>
   二级：<section style="display:flex">…图标…<section><p><span><strong>3.1 开箱即用：…</strong></span></p></section></section>
   转换器只认 h* 标签，普通 section 一律当正文，视觉上的层级就没了。
3.新增 lib/compat.js（149 行，入口 WXMD_COMPAT.normalizeCompat，content.js 381 行调用）：这是「微信特殊排版兼容层」，只收通用规则认不出来的特殊结构；代码块在 lib/codeblock.js，正文段落/列表/引用在 content.js，以后同类特殊形态都往这里加，不再散回 content.js。
4.识别规则（lib/compat.js 58 行 normalizePseudoHeadings）：
   - 中文序号「一、背景」→ h2（改成 ##），数字多级编号「3.1 xxx / 3.1.2 xxx」→ h3（###）；
   - 文本长度 ≤ 40 且不含句末标点（。！？；），避免把「一、二线城市是…。」这类正文句子当标题；
   - 不在 li / pre / blockquote / table / 已有 h* 里；
   - 结构必须干净（isSimpleBlock，110 行）：不含 img/svg/video/br/ul/ol/table/pre/blockquote/hr，容器层数 ≤ 2；
   - 数字编号额外要求加粗（isBold，118 行，<strong>/<b> 或 style 里 font-weight:bold/600-900）；
   - 「标题 + 配图」的组合容器不处理（hasMediaInHolder，133 行）：容器里除了这段文字还有图片/图标时保持原样，免得把图注抬成小节、图片位置乱掉；
   - 同一处标题常被多层 section 包着，只替换最内层（否则会输出两个标题）。
5.注入位置：background.js 的 executeScript files 与 popup.js 的 INJECT_FILES 都在 content.js 之前加了 'lib/compat.js'；用 var 挂 WXMD_COMPAT，与 WXMD_NAMING / WXMD_CODE 同一套写法。
6.降级：模块缺失不阻断导出，content.js 打印 console.error('[wx-md] lib/compat.js 未加载…')，只是伪标题会退回普通段落。
7.实测（目标文章）：输出 5 个 ## + 5 个 ###，层级与原文一致 ——
   ## 一、背景 / ## 二、What is Zvec? / ## 三、Why Zvec? / ### 3.1~3.5 / ## 四、后续规划 / ## 五、加入我们；11 张图片占位不变，代码块 2 个不变。
8.回归：live 16 个标题 / live1 8 / live2 8 / live3 2，与改动前完全一致（都是原有 h*，没有新增误判）；视频文章 10 条附件、合成夹具 9 条、代码块夹具 5 个围栏（含 ```java）均不变。
9.夹具边界（10 个场景）：中文一级 ✓、数字二级 ✓、三级 3.1.2 ✓；正文句「一、二线城市…。」不转、加粗非编号不转、列表项不转、引用块不转、带图片容器不转、真 h2 不重复包装。
10.已知限制：「3.14 圆周率」这种「一位整数 + 两位小数 + 空格 + 短词」且被加粗的独立段落，会被当成三级标题（正则无法区分 3.1 与 3.14）。真实文章里这类文字通常不加粗，触发概率很低；要收紧就把 lib/compat.js 的 NUM_HEADING_RE 改成只认 {1,2} 位段。
AH.播放器 UI 过滤、浮动序号合并，代码按职责分模块（v16.17.0）：
1.问题一（https://mp.weixin.qq.com/s/NDNH_26mMGSFDl8C3ARirg）：导出后有大量重复内容，正文里混进「已关注关注重播 分享 赞 / 关闭观看更多 / 退出全屏 / 切换横屏 / 进度条百分之0 / 倍速播放中 0.5倍 0.75倍 / 视频详情 / 继续观看 + 文章标题 + 观看更多转载…」。
   根因：微信把整台播放器渲染在容器里，结构是 span#js_mp_video_container_N.video_iframe > #page-content > #js_mpvedio_wrapper_* > (.appmsg_video 点赞面板 + .feed-wrapper 倍速条/观看更多) + #bottom_bar 视频详情，真正的 <video> 埋在最里层。旧逻辑只把那个 <video> 换成链接，整台播放器的 UI 文案全部留在正文里，于是每个视频后面都跟一段同样的「已关注…」，还把文章标题、作者重复一遍。
   修法：新增 lib/attachment.js，按「最外层播放器容器」整块替换。findCarrier()（122 行）从内向外扫，取最外层匹配 .video_iframe / [id^=js_mp_video_container] / mp-common-videosnippet / mp-common-videochannels / .appmsg_video / [id^=js_mpvedio_wrapper] 的祖先；只替换最近一层是不够的（.appmsg_video 只包点赞面板，倍速条在 .feed-wrapper）。读不出地址的容器（PLAYER_CHROME_SEL，31 行）在 content.js 242 行整块删除，不留「已关注…」残渣。
2.问题二（https://mp.weixin.qq.com/s/CwRObRhAR-j9t5-DYaAEMA）：导出后「1.」单独一行、正文另起一行，「1.多角色智能配音：」被拆成两段。
   根因：这类「有序列表」不是 <ul>/<ol>，而是浮动序号：<section display:block;clear:both><section float:left;width:24px>1.</section><section margin-left:24px>正文</section></section>。序号和内容是并列的两个块级 section，转换后各自成段。
   修法：lib/compat.js 新增 normalizeFloatingMarkers()（69 行）——识别「纯序号（1. / 1、/ (1) / a) / - / • / ① / 一、）+ style 里写了 float」的叶子节点，把序号并进后面内容块的开头，再删掉序号节点。用 inlineTarget()（126 行）沿「唯一子元素」钻到真正承载文字的那一层，否则文本插在外层容器上仍会单独成段。
3.安全边界：序号长度 ≤ 4 字符且必须匹配序号正则；里面混了 img/svg/br/ul/table/pre/video 就不动；真 <li>、引用块、代码块、表格里的序号不处理；后面跟的是图片/列表/表格就不合并（宁可保留原样）；非 float 的「4.」独立段落保持原样。
4.输出形态：中文序号「3、」不加空格，直接粘正文；西文「1.」「•」补一个空格。Turndown 会把行首「1. 」转义成「1\. 」，这是它的列表保护，渲染出来仍是「1. 多角色智能配音：…」一行，不额外做反转义——否则正文里本来以「1. 」开头的普通段落会被误变成列表。
5.代码整理（这次的主要工作量，目标是不再出现互相打架的兼容逻辑）：
   lib/attachment.js 233 行  视频/语音：collect 53、findCarrier 122、readAttachment 133、PLAYER_CHROME_SEL 31
   lib/codeblock.js  344 行  代码块：等宽 <p> / 编辑器 pre / 伪 pre
   lib/compat.js     254 行  特殊排版：normalizeCompat 43（入口）、normalizeFloatingMarkers 69、inlineTarget 126、normalizePseudoHeadings 162
   content.js        486 行（原 602 行）  图片（唯一下载的附件）、引用块 397、嵌套列表 445、段落/图片/附件三条 Turndown 规则、YAML 收尾
6.规则优先级写死在 content.js 244-262 行，四条互不重叠：① 代码块 → ② 引用块 → ③ 特殊排版（compat）→ ④ 嵌套列表。引用块排在伪标题前面是有意的：微信用左边框画的引用块是作者的明确意图，「带左边框的标题」只是我们的猜测，宁可当引用也别把引用拆成标题。compat 内部一律跳过 blockquote / li / pre / table，不再回头改引用块里的东西。
7.内部函数重排：normalizeQuotes / normalizeNestedLists 从「return 之后」挪到 return 之前（content.js 397 / 445 行），不再依赖函数声明提升；原来那几个「实现已迁走」的占位注释也删了，模块分工写在文件头 1-6 行。
8.降级：lib/attachment.js 缺失时 content.js 打 console.error 并在下一步把播放器外壳整块删掉（少链接但不留垃圾文案）；lib/compat.js 缺失时伪标题与序号合并不生效；lib/codeblock.js 缺失时代码块退化成行内 code。三者都不阻断导出。
9.实测：
   NDNH（视频文章）md 从 6565 字符降到 3955，10 条视频链接不变，「已关注/重播/观看更多/退出全屏/倍速/进度条/视频详情/继续观看」全部为 0 次，无重复长段落。
   CwRObRh（编号文章）输出「1\. **多角色智能配音**：导入书籍后开启…」一行，18 张图、1 条视频链接不变。
   回归：SpringBoot 19 块代码 / IP 归属地 3 块 / PDF 2 块 / 苹果 19 图 / Zvec 2 块 + 10 标题，字符数与改动前逐字一致。
   夹具：视频 8 种形态 9 条链接不变；代码块 5 个围栏（含 ```java）；新增 8 个场景（浮动数字序号 / 中文序号 / 项目符号 / 非浮动序号不动 / 序号后跟图片不合并 / 真 ol 不受影响 / 播放器外壳只留链接 / 空播放器整块清掉）全部符合预期。
   node --check 五个文件 + --pack-extension 打包通过（产物已删）。
10.已知限制：浮动序号只认「纯序号」，像「步骤1」「版本3.」这类混在句子里的编号不处理；「1.」并回正文后 Turndown 会加转义反斜杠，纯文本编辑器里能看到「1\.」，渲染后是「1.」。
AI.列表里手写序号去重（v16.18.0）：
1.症状：https://mp.weixin.qq.com/s/Q887XL0LHqpdObwIVp3nnQ 开头「1. 工具载体：VS Code…」这组导出后每行都是「1.  1\. 工具载体…」——序号显示了两遍；更严重的是后面「2. 创建 Github Repository」「3. 下载 Github Desktop」…「14. 定时同步」共 13 步，导出后全变成「1.」，序号彻底乱掉。
2.根因：这一篇的「有序列表」编号是作者手打进正文的，DOM 是 <ol><li><section><span>1. 工具载体：VS Code…</span></section></li></ol>——<ol> 自己不带编号样式（微信 CSS 把 list-style 干掉了），编号只是文字。Turndown 的 rules.listItem 会给每个 <li> 自动补一个「1.  」前缀，于是「自动序号 + 手写序号」叠在一起。又因为每一步后面都跟着截图，排版器把每一小步都收成一个独立的 <ol>，自动编号每段都从 1 开始数，13 个单步列表于是全成了「1.」。
3.修法：lib/compat.js 新增 normalizeManualListNumbers()（85 行）：li 开头的手写序号认定为作者意图——从正文里摘掉，改成所在 <ol> 的 start 属性，交给 Turndown 按 start + 位置编号（rules.listItem 读 parent 的 start）：「2. 创建 Github Repository」所在的单步 ol 设 start=2，输出就是「2. 」，不再是「1.」。
   - 序号正则 MANUAL_NUM_RE（42 行）覆盖 1. / 1、/ 1) / 1）、/（1）/(1)；末尾的 (?!\d) 专门拦「1.5 版本修复了闪退」，不会把「一点五」当「第 1 条」摘掉。
   - <ul> 里如果「每一项」都手写了序号（秀米常见的 <ul><li>1、xxx</li>…</ul>），说明本来就是有序列表，直接换成 <ol> 并带上 start；只写了一部分的（可能是正文恰好以数字开头的条目）不动，保持「-   1、第一条」原样。
   - 只处理列表的直接子项，嵌套列表各归各的父级；readManualNumber（138 行）只读「这一项的第一段文字」（firstTextNode 166 行跳过子列表/代码/引用/媒体），不会把子列表的文字当父项的序号。
   - 整项只剩一个序号、没有正文的（<li>1.</li>）不摘：摘完会变成一个空列表项，保留原样至少还看得出编号。
   - 摘完序号后变空的行内壳子（<span>1.</span>）一并删掉（pruneEmptyShell 205 行），不留空段落。
4.同一篇顺带修的两处（都是导出后直接看得见的错）：
   - 「用标题撑间距」的空标题 <h1><br></h1> 会留一行孤零零的「#」，现在在清理阶段整块删掉（content.js 242 行，只删既没有文字也没有媒体的 h*）。
   - 「以下是保姆级教程：」在原文里是真 <h3>，只因为带了一条 border-left 装饰，被 normalizeQuotes 当成引用块转成了「> 以下是保姆级教程：」。content.js 420 行加了跳过：真 <h1>~<h6> 是结构、左边框只是装饰，不能再反过来把标题拆成引用（伪标题才是靠猜测，两者不冲突）。
5.实测（目标文章）：双序号 19 处 → 0；编号 1~7、9~14 连续（「安装 Markdown Image 插件」那一步原文自己写的就是「1.」，应为 8，按原文保留）；3 个 h3 由引用块恢复成「### 以下是保姆级教程：/ ### 到这里…/ ### 写在最后」；29 张图、3 个代码块不变；md 4797 → 4715 字符（去掉的是重复序号、空「#」和「>」标记）。
6.回归：live / live3 / live4 / live5 / live6 五篇逐字一致；live1 的嵌套目录「1、引入依赖 / 2、下载离线库 / 3、简单使用」由「-   1、…」变成「1.  …」（本来就是有序的，属预期变化）；live2 两个真 <h3>「获取 MinerU API Token」「安装 skill 包」由引用块恢复成「###」（预期变化，同一类问题）。
7.夹具（build_list.js，15 个场景）：单 ol 多项 ✓、每步一个 ol 的 4/5/6 续号 ✓、ul 全项带号 → ol ✓、ul 从中间开始编号（5、6、7 → start=5）✓、ul 部分带号保持原样 ✓、1.5/2.0 版本号不误摘 ✓、（1）(1) 括号序号 ✓、只剩序号的项不动 ✓、父项 2 + 子项 1/2 各自编号 ✓、序号单独成 span ✓、真 ol 不加 start ✓、带边框 h3 保持标题 ✓、空 h1 不输出「#」✓、中文序号不处理 ✓、li 里带图片不误判 ✓。
8.已知限制：手写序号「作者写多少就是多少」，不做顺延纠正——这篇第 8 步写成 1，导出也就是 1。要做「按位置重排」得再加一层跨列表的连续编号推断，误伤风险高（两组独立的 1、2、3 列表会被错误接续），暂不做。
9.node --check 六个文件 + --pack-extension 打包通过（产物已删）。
AJ.状态提示自动消失 + 快捷键悬浮说明（v16.19.0）：
1.问题一：「导出成功！」「已取消固定」这类回执一直挂在界面上，不消失也没有动效，看起来像卡住了。
   修法：popup.js（42 行）和 floating.js（492 行）把状态写入统一收敛到一个 setStatus(text, kind, holdMs) 出口。成功类（kind='success'）默认 3.2 秒后淡出：先加 .fading（CSS opacity 0.25s 过渡），260ms 后清空文本并把 class 复位；进行中（正在提取/正在下载）和失败/超时不自动消失——这类信息还没看完就抹掉比留着更麻烦，失败后往往还要回头查下载目录。
   时长取值：3.2 秒够读完「导出成功！」再回神，再长就会和下一次操作的状态打架。要调只改 STATUS_HOLD_MS 一个常量（popup.js 39 行 / floating.js 489 行）。
   坑：新的 setStatus 必须 clearTimeout 上一轮定时器，并用「整体覆盖 className」的方式清掉残留的 fading；否则上一次的淡出定时器会在这一次提示刚出来时把它抹成空白。
2.问题二：浮窗里的「⌘ S / Ctrl S」只在浮窗展开时生效（keydown 里判了 host 可见 + panel.open），但界面上没有说明；收起成圆球后按快捷键只会触发浏览器自己的「保存网页」，容易被当成扩展失灵。
   修法：快捷键徽标 kbd#wxMdKbd 挂 data-tip，CSS ::after 用 attr(data-tip) 画深色气泡（floating.js 246-290 行），悬停徽标显示、移开淡出；文案按平台生成（546-551 行）：「⌘ S 只在浮窗展开时生效；收起成圆球或关闭浮窗后，按下会触发浏览器自带的「保存网页」。」其中保存入口的名字也分平台（Windows「保存网页」/ macOS「存储为…」）。同时写 aria-label，键盘 focus（:focus-visible）也能看到。
   为什么挂在徽标上而不是整个面板：导出按钮是高频点击区，跟着按钮 hover 弹提示会挡住选项；徽标本身就是「这条提示在讲快捷键」的锚点。气泡右对齐徽标、向左展开，不会溢出 320px 面板。
3.验证：浮窗夹具（测试时把 attachShadow 临时改 open 才能外部断言 + 强制显示 tooltip 截图）点导出 → t0「正在提取文章...」、t1.2s「导出成功！」cls=wx-md-status success、t3.8s 文本已清空且 class 复位；截图确认气泡在面板内、箭头指向徽标、无裁切；node --check floating.js / popup.js 通过；--pack-extension 通过（产物已删）。
（AK 起气泡挂载点改为整颗导出按钮，本条「挂徽标」的取舍已废弃，见 AK。）
AK.快捷键说明改挂整颗导出按钮（v16.20.0）：
1.改动：气泡原先只在右侧那枚 kbd 徽标上弹出，鼠标得精确移到 30px 宽的小胶囊上才看得到，实际很难发现。现在整颗「导出当前文章」按钮都是说明入口——鼠标落在按钮任意位置（图标、文字、徽标）都会浮出同一段气泡。
2.实现：CSS 伪元素从 .wx-md-kbd::before/::after 整体挪到 .wx-md-export::before/::after（floating.js 242-300 行），按钮补 position: relative（221 行）作为定位基准；气泡 left: 50% + margin-left: -104px 居中于按钮，箭头同样居中指向按钮，不再右对齐徽标。文案改由 exportBtn.dataset.tip 写入（floating.js 561 行），kbd 只留文字（549 行），原先写在 kbd 上的 aria-label 一并去掉——它嵌在按钮里，会把按钮的无障碍名读成「导出当前文章 Ctrl S 只在浮窗展开时生效…」，反而更吵。
3.细节：导出进行中（.wx-md-export:disabled）不弹气泡（293-299 行，靠放在 hover 规则之后覆盖），避免等待期间这段与进度无关的说明压在选项区上；气泡 pointer-events: none，盖住「归档方式」时也不影响点击；面板 overflow: hidden，气泡居中后仍完整落在 320px 面板内（宽度处理见 AL）。
4.验证：浮窗夹具改为「把 :hover 伪元素规则替换成常显」来模拟悬停（原注入 style 的方式进不了 closed shadow），探针读到 btn.tip 有文案、kbd.tip 为空、::after 的 content 解析成该文案、按钮 position=relative；截图确认气泡在面板内水平居中、箭头指向按钮、无裁切；状态提示时序（t0 → 1.2s 成功 → 3.8s 清空）不受影响；node --check 全通过，--pack-extension 通过（产物已删）。
AL.说明文案简化 + 平台快捷键判断加固（v16.21.0）：
1.问题一：AK 那句「Ctrl S 只在浮窗展开时生效；收起成圆球或关闭浮窗后，按下会触发浏览器自带的「保存网页」。」信息量对，但三行黑底压在「归档方式」上挡视野，读起来也啰嗦——用户只想知道「什么时候能用」。
   改法：文案收成一句「⌘ S 仅在浮窗展开时生效」（floating.js 564 行），去掉对「收起后会落到浏览器保存对话框」的解释；气泡宽度不再固定 208px，改成 white-space: nowrap + left:50% + transform: translateX(-50%)（259-261 行），宽度跟着文字走，padding 收到 5px 9px、圆角 6px、投影减轻。现在是一行小胶囊，只压在按钮正上方一小条。
   连带删掉不再需要的按平台取「保存网页 / 存储为…」的分支。
2.问题二（用户提问）：Mac 上会不会显示成对应的快捷键？——会，徽标和气泡共用同一个 isMac 判断（556 行）：Mac 显示「⌘ S 仅在浮窗展开时生效」，其它平台显示「Ctrl S …」。
   顺手加固平台判断：原来只看 navigator.platform || userAgent，新版 Chrome 的 navigator.platform 已不推荐依赖，改为优先 navigator.userAgentData.platform（UA-CH），再退回 navigator.platform，最后兜底 userAgent；正则同时认 mac/iphone/ipad/ipod 与「Mac OS X」，其余一律按 Ctrl S 显示。
3.验证：Windows 夹具读到 btn.tip「Ctrl S 仅在浮窗展开时生效」；mac 模式夹具（探针前 Object.defineProperty 伪装 navigator.userAgentData.platform='macOS'）读到「⌘ S 仅在浮窗展开时生效」，::after 的 content 同步；截图确认气泡缩成单行、宽度约为按钮一半、水平居中、箭头指向按钮、无裁切；状态提示时序不变；node --check 全通过，--pack-extension 通过（产物已删）。
AM.快捷键说明改用原生 tooltip（v16.22.0）：
1.问题：AK/AL 自绘的黑底气泡与面板里其它提示不是一套东西——球体「按住可拖动 · 点击展开/收起」、固定/最小化、「每篇文章单独一个文件夹…」「所有文章与附件置于同一文件夹…」用的都是原生 title，灰白小纸条、悬停约 0.5~1 秒后才出；自绘气泡则是立刻淡入、深色、带箭头，混在一起像是另一套设计语言。
   改法：删掉整段 .wx-md-export::before/::after 样式（原 241-300 行，连带 ::hover / :disabled 覆盖共 50 行）和按钮上的 position: relative，改为 exportBtn.title（floating.js 508 行）。样式和出现延迟从此完全交给浏览器，与其它提示逐字一致，不再需要维护三角、投影、圆角、宽度这些参数。
2.保留的：文案仍按平台生成（503-508 行）Windows「Ctrl S 仅在浮窗展开时生效」/ macOS「⌘ S 仅在浮窗展开时生效」；徽标 kbd 仍显示对应按键。
3.已知代价：原生 title 只在悬停时出现，键盘 focus 不会弹（自绘版有 :focus-visible 支持）；另外挂的是整颗按钮，鼠标停在按钮任意位置都会出，和归档方式按钮的行为一致。
4.验证：浮窗夹具读到 btn.title 有值、::after 的 computed content 为 "none"（确认自绘气泡已彻底移除）；mac 模式夹具读到「⌘ S 仅在浮窗展开时生效」；状态提示时序不变；node --check 全通过，--pack-extension 通过（产物已删）。原生 tooltip 由浏览器 UI 绘制，截图抓不到，只能靠属性断言。
