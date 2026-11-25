
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
AN.图片消息（图文 / 小绿书）适配：补全图片 + 清 UI 噪音（v16.23.0）：
1.问题：https://mp.weixin.qq.com/s/z4ujxrVatZ7kK_iAb6Ev5Q 这类「图片消息」导出后 0 张图，尾部还多出「原文 xxx」「山西,11月4日,」两行。原因是微信两套模板：普通图文所有内容都在 #js_content 内；图片消息的 #js_content 里只有 #js_image_content（<h1> 标题 + <p id="js_image_desc"> 正文），真图全在 #js_content 之外的轮播区 #img_list 里。content.js 的 ARTICLE_SELECTOR='#js_content' 扫不到任何 <img>，于是 images=0；同时 <h1> 与 YAML 标题重复、#js_origin_source / .rich_media_meta_area_extra 属于 UI 噪音。
2.改法：新增 lib/imagepost.js（175 行，var WXMD_IMAGEPOST），入口 prepare(clone, pageRoot, log)：
   - 判定：pageRoot.querySelector('#js_image_content, #img_list')（25 行），不存在立即 return —— 普通图文零影响；
   - 取图：collectUrls（83 行）按 #img_list .swiper_item 的 DOM 顺序取 data-src（原图），没有才退回内层 img[src]（那是 tp=webp&watermark=1 的展示副本）；decodeUrl（50 行）还原 &amp;、补全 // 协议相对；keyOf 按 path 去重（同一张图常带不同 query）；
   - 插图：把图按顺序塞进一个 div，插到 #js_image_desc 之后（文字在前、图在后；无描述段时挂在 #js_image_content 后），插进去就是普通 <img src>，后续 data-img-idx → {{IMG_n}} → 并发下载 → 命名模板全部复用原链路，下载侧一行未改；
   - 清理：NOISE_SEL（38 行）删 h1.rich_media_title、#js_origin_source、.rich_media_meta_area_extra、#js_ip_wording_wrp、#publish_time、.rich_media_meta_list 等；删前判一下里面有没有 #js_image_desc，避免旧模板把正文塞在 meta 容器里被误删；
   - 兜底告警：readAnnouncedTotal（68 行）读轮播角标「共 N 张」，实际取到的少于它时 console.warn，防止微信将来改成只渲染可视区时静默少图。
3.接线：background.js 128 行、popup.js 21 行注入列表各加 'lib/imagepost.js'；content.js 187-188 行在附件处理之后、图片统计之前调用（图片统计必须在其后，否则补进来的图不会被登记下载）。
4.实测（该文）：改前 mdLen 1230 / 0 张图 / 尾部两行噪音；改后 mdLen 1404 / 15 张图，正文全在图片之前，噪音 0；15 条地址均为 data-src 原图（wx_fmt=png，无 tp=webp / watermark=1），path 全不重复，实测 curl 三张（第 1/8/15 张）均 200 image/png（50 万 / 6.8 万 / 13.7 万字节）。
5.回归：live / live1~6 七篇 + q887 与改前逐字一致（判定不命中即走原路径）；新增夹具 build_imagepost.js 7 个场景全过：15 张 data-src + 全部噪音（噪音残留 0、结构为「文字,图×15」）、只有 img[src] 含 // 协议相对、同图不同 query 去重、data-src 与 img 混排保序、无描述段挂容器后、普通图文零影响（h1/meta/origin_source 三个节点必须留着）、角标 15 实际 8 触发告警。
6.node --check 八个文件 + --pack-extension 打包通过（产物已删）。
AO.全量排查后的修复：首图取错 / 裂图 / 浮窗越界挂载 / 判定绑死 id（v16.24.0）：
1.图片消息首图取的是占位副本（lib/imagepost.js）：轮播第 1 项是「撑开尺寸的空壳」，没有 data-src、只有一张 img[src]，path 与真图第 1 张相同。旧实现逐项「没有 data-src 就退回 img[src]」，第 1 张因此取副本（带 usePicPrefetch），只是靠后面的按 path 去重才和真图合并，看上去正常。
   改法：collectUrls（113 行）改两遍扫描——先收集全部 data-src 的 path 白名单（117-121 行），第二遍没有 data-src 的项只有在「img[src] 的 path 不在白名单」时才计入（136 行）；空壳容器整项跳过（PLACEHOLDER_SEL，52 行）。实测该文首图从 `…&usePicPrefetch=1&tp=webp` 副本变成 `4ZXa4EZoNftwCd0tvoZGZMZia…` 原图，15 条全部 wx_fmt=png 且无 tp=webp / watermark=1。
2.图片下载失败 → md 里写的是本地不存在的路径（background.js 304 行）：旧逻辑失败项不进 actualPath，替换时回落到 pathByIndex（按命名模板预算的路径），指向一个没落盘的文件，就是裂图。改为与「内网地址」分支一致，失败时 actualPath.set(i, item.url) 回写原始 URL，图还能点开。
3.浮窗在非文章页也挂载（floating.js 24-51 行）：content_scripts 的 matches 是 https://mp.weixin.qq.com/*，域名下还有首页、视频播放页、历史消息页等，固定后点导出必报「未找到文章正文」。新增 IS_ARTICLE_PAGE：先看 DOM（#js_content / .rich_media_content / #js_image_content / #activity-name），再按路径兜底（/s、/s/xxx、/mp/appmsg/show），不命中就 host.remove() 并 return。
4.图片消息判定绑死 id（lib/imagepost.js 32-45 行）：DETECT_SEL 原来是 '#js_image_content, #img_list'，只有 class 的同类模板命中不了、退回 0 图。改成 id + class 都认（#js_image_content / .image_content / #img_list / .img_swiper_area / .img_swiper_content），ITEM_SEL 补 .share_media_swiper_content .swiper_item。
   为防止宽判定误伤，噪音清理前加 looksLikePost 闸门（218 行）：没有取到图、clone 里也没有 #js_image_content / #js_image_desc 时，一个节点都不删。
5.正文根节点硬依赖 #js_content（content.js 20 行、169-176 行）：换成候选列表依次命中 #js_content → .rich_media_content → #js_image_content，第三项专门兜「图片消息不套 #js_content」的模板；都不命中才报「未找到文章正文」，fallback 命中时 LOG 记录用的哪个选择器。
6.顺带（小毛病）：
   - 拖面板标题会给圆球加 .dragging 且吞掉下一次点球（floating.js 633-690 行）：拆成 dragMoved（是否移动）/ dragFromBall（起点）、ballMoved 只在「从圆球开始且真的移动」时才置 true，.dragging 也只加给圆球。
   - 图片消息模板里首图若已在正文中，轮播补一遍会重复：插入前用 clone 里已有 img 的 path 建集合，命中就跳过（177-196 行）。
   - 配置页平台判断与浮窗不一致（options.js 77-81 行）：统一为 UA-CH → navigator.platform → userAgent。
   - 公网 IPv6 图床被误判内网（lib/defaults.js 80-84 行、content.js 86 行兜底副本）：不含点但含冒号的 IPv6 地址不再当内网主机名。
   - 配置页路径预览固定拼 .png（options.js 267/390 行）与实际扩展名可能不同，属示例展示，未改。
7.验证：
   - 夹具 build_imagepost.js 扩到 9 个场景全过，新增「空壳项不占位（取原图、不重复）」「假命中 .image_content 不误删」。
   - 新增 build_root.js：.rich_media_content 兜底、只有 #js_image_content 的图片消息、非文章页明确报错，8 项断言全过。
   - 新增 build_float_guard.js：首页 / 视频播放页 / 历史消息页不挂，文章页 / 图片消息 / 正文未渲染但路径是 /s 时挂，7 个场景全过。
   - 新增 build_float_drag.js：拖标题不再给圆球加 dragging、也不再吞下一次点球；拖圆球仍吞 click、松手移除样式，4 项全过。
   - 回归：live / live1~6 + q887 与改前逐字一致（字符数一分不差）；z4 仍 15 图 / 1404 字符，首图已换原图。
   - 浮窗状态提示与快捷键夹具（Windows / mac 两种）输出不变。
8.node --check 八个文件 + --pack-extension 打包通过（产物已删）。
AP.表格识别修复：单元格里的块级容器会把表格拆散（v16.25.0）：
1.症状：https://mp.weixin.qq.com/s?__biz=MzA4OTY3ODQzNw==&mid=2448504562&idx=1&sn=54186a20e3c4ffa77120473e1b5969fa 「一、官网这5句宣传，句句都得翻译成人话」下面那张 4 列 × 5 行的表格导出后不是表格，而是一堆带「|」的普通段落，每个单元格的文字前后还各空一行。
2.根因：表格本身是标准结构 <table><thead><tr><th><section><span>…，GFM 规则认得出；坏在 wechatSection 规则——单元格里的 <section> 是「只有行内内容的叶子」，规则给它前后补了空行，单元格内容于是变成「\n\n卖点\n\n」。GFM 表格按「一行一组 | 分隔符」识别，单元格里一出现换行，这一行就从中间断开，整张表退化成段落。
3.修法一（结构层）：新增 normalizeTableCells()，排在嵌套列表之后（结构归一第 5 步）。单元格里全是块级容器时，把容器内容摊平进单元格：块与块之间插一个 <br>，行内标签（span/strong/a）原样保留；含图片 / 代码 / 嵌套表格 / 列表的单元格整格跳过，交给规则层压平，避免丢内容或撑坏列宽。
4.修法二（规则层）：接管 gfm 的 tableCell 规则（wxmdTableCell）——内容里的换行统一压成空格，裸「|」转义成「\|」（不转义会被当列分隔符，凭空多一列）；首列判断改用 previousElementSibling 而不是 childNodes 下标，单元格之间夹一个空白文本节点也不会丢掉行首竖线。
5.修法三：新增 wxmdCellBreak，单元格内的 <br> 写成字面 <br>——Turndown 默认输出「两空格 + 换行」，同样会截断表格行。wechatSection / wechatImage 在 th、td 内不再补空行，兜住被跳过的复杂单元格。
6.顺序注意：normalizeTableCells 在 Turndown 之前执行；常量 CELL_BLOCK_RE 必须定义在调用点之前，否则 const 的 TDZ 会让整个导出直接抛错。
7.实测（目标文章全篇）：mdLen 3601 / 16 图 / 3 代码块；表格输出为
   | 卖点 | 官网口径 | 人话翻译 | 适合 |
   | --- | --- | --- | --- |
   | 永久免费 | 免费档 5GB 空间、不限流量 | 长期不缴费也能用 | 试验站、短期项目 |
   4 行数据齐全，表格前后的空行正常，图片与代码块不受影响。
8.回归：live / live1~6 / q887 七篇与改前逐字一致（只有 exported 时间戳不同）；z4 仍 15 图 / 1404 字符；live 的 19 个代码块、q887 的 29 张图均不变。
9.夹具（6 个场景）：section 包裹的基础表格 ✓、单元格两段 → <br> ✓、单元格含图片（单行 {{IMG_n}}）✓、单元格含列表（压成「- 甲 - 乙」）✓、单元格含竖线 → \| ✓、无表头表格仍保留 HTML ✓。
10.已知限制：colspan / rowspan 没有对应的 GFM 语法，带合并单元格的表格会少列（文字不丢）；没有表头的表格仍按原 HTML 保留（旧行为）；单元格里的列表会被压成一行。
11.node --check content.js + --pack-extension 打包通过（产物已删）。
AQ.代码审查整改（16 项）与模块拆分（v16.26.0）：
1.段落（P1）：用 <div> 直装正文段落的模板（转载模板、部分第三方编辑器）整篇粘成一段。removeEmptyInline 规则原先对 div 只 return content，Turndown 给块级节点补的间距被吞掉，且不报错。改为按块级处理：补空行；表格单元格内保持单行、列表项内不补（否则紧凑列表会被撑散）。
2.安全（P1）：图片域名白名单。只看 hostname 挡不住「域名 A 记录指向内网」的盲 SSRF，扩展里没有 DNS 解析能力，所以默认只下载微信图床（qpic.cn / qlogo.cn / wx.qq.com / gtimg.cn / gtimg.com，后缀匹配含子域名），其余图片保留在线链接。配置页新增「下载第三方图床的图片」开关，默认关闭。
3.并发（P1）：导出锁（按文章 URL，10 分钟自愈）。浮窗与弹窗可以同时触发同一篇导出，两套下载各 4 路并发、conflictAction 互相改名，结果是图片目录堆副本、md 指向不确定的那一份。不同文章仍允许同时导出。
4.计时（P1）：看门狗从「总共最多等多久」改成「多久没进度」。后台每完成一张图广播 EXPORT_PROGRESS（节流 500ms），popup / 浮窗收到就续期。原公式 60s + 图片数×1.5s 在 40 张图时会于 120s 提前报超时，而真实最坏耗时 200s。
5.交互（P1）：非文章页点「固定」的假成功。floating.js 原先在注册 onMessage 之前就 return，popup 的 sendMessage 必然 reject 且被 .catch(() => {}) 吞掉；用户看到「成功」，页面上什么也没有，而 pinned 已落库，下次打开任意文章页浮窗会自己冒出来。现在 popup 先探活（#js_content / .rich_media_content / #js_image_content / #activity-name），浮窗在非文章页也会回一条 ok:false，弹窗据此撤回 pinned 并给出真实原因。
6.配置（P1）：保存时校验空模板。onlineFilename / downloadFolder / imageFilename / sharedFilename / sharedImageFilename 留空会把所有文章塌到 article/article.md（Chrome 再依次改名 article (1).md），图片也全混在一个目录，且不报错。
7.体积（P2）：1.4MB 预检从「所有图片下载完之后」提前到下载之前（按替换后的字节数估算），不再出现「等了几分钟、提示超限、磁盘上多一堆没人引用的图片」。提示按模式区分：在线模式建议改「下载到本地」，本地模式建议缩短目录模板。
8.空值（P2）：markdown 只有空白时直接报错，不再生成一个只有 YAML frontmatter 的文件并显示成功。
9.反馈（P2）：图片下载失败 / 被拦截 / 占位符残留三个计数随 sendResponse 回传，界面提示「导出成功，但 3 张图片下载失败；这些位置保留为在线链接」。原先只有 console.warn，用户下次打开笔记看到裂图才知道。
10.一致性（P2）：新增 fitImageRel——图片目录与文件名先按剩余预算压好（总长 ≤200），再用同一组 imgDir / filename 生成 md 引用；文章目录本身也先 limitPath 到 160。原先只裁下载路径、引用仍用完整目录，目录+长标题时必然裂图。
11.代码块（P2）：收尾整理跳过围栏代码块。整篇的 \n{3,} 压缩与「只含空格的行清空」会把代码里的连续空行、Makefile 的 tab 空行改掉；现在只处理围栏之外的文本。已知限制：代码块内部本身含一行 ``` 时会被当分隔符提前切断（极罕见）。
12.表格（P2）：单元格跳过清单补 svg / math。纯图标单元格原先会被摊平，flattenCellInto 对 svg 走 cloneNode(false) 只留空壳，图标内容直接丢。
13.规整：新增 lib/blocks.js（引用块 + 嵌套列表）、lib/tables.js（单元格摊平 + wxmdTableCell / wxmdCellBreak 两条规则）、lib/injectlist.js（注入清单与 pickArticleData 单一来源）、lib/download.js（downloadFile / mapLimit / toDataUrl / byteLength）。content.js 649 → 532 行，background.js 只留调度、路径与统计。
14.规整：路径清洗统一到 lib/naming.js（sanitizeSegment / sanitizePath，含 Windows 保留名、80 字符段长、过滤 . 与 ..），background 的 cleanSegment 删除，预览与落盘不再有两套规则；sanitizePath 不再做 100 字符整体截断（会把最后一级目录截丢），总长交给 limitPath。content.js 版本号改为从 chrome.runtime.getManifest() 读取；turndown / turndown-plugin-gfm 头部补来源与版本注释。
15.测试：新增 package.json 与 test/（node --test + jsdom，31 个用例）。直接在 jsdom 里注入真实的 lib 与 content.js，不是复制一套逻辑。覆盖：div 段落 4 例、三连空行、表格 5 例（section 单元格 / 竖线转义 / 多段 <br> / svg / 图片）、代码块空行、引用块、嵌套列表、图床白名单 3 例、data-src 优先级、图片消息补图；另有命名与安全判断 9 例。npm test 全绿。
16.回归：live / live1~6 / q887 八篇与改前逐字一致（jsdom 新旧同环境对照）；表格文章 3558 字符 / 16 图 / GFM 表格正常；z4 仍 15 图。node --check 全部通过，--pack-extension 打包通过（产物已删）。
AR.视频号卡片识别与定位（v16.27.0）：
1.症状：https://mp.weixin.qq.com/s/hX_WmYpYDJAo3y5C-zQAAg 导出后，正文里那个视频（新华社「40秒热门短视频」）整块消失。2229 字符 / 6 图，图注「▲2月10日，贵州省委政法委…」后面直接接下一段正文，连「视频」两个字都没有。
2.根因一（代码）：lib/attachment.js 的 MEDIA_SEL 只有 mp-common-videosnippet / mp-common-videochannels，没有 mp-common-videosnap；PLAYER_WRAP_SEL 里只有 .video_iframe，而这类卡片的 class token 是 videosnap_video_iframe（CSS class 选择器按整 token 匹配，多一个前缀就不命中），.channels_iframe / .channels_iframe_wrp 也都不在清单。三个选择器全部落空 → 节点原样交给 Turndown → 未知标签、无文本 → 输出空字符串。
3.根因二（能力）：videosnap 是「视频号」卡片，和公众号自营视频（videosnippet → wxv_xxx → readtemplate 播放页）不是一回事。实测：组件 shadowRoot 里只有卡片 UI（I.weui-play-btn_primary、昵称「新华社」、认证标、2704 赞），整页 <video> 元素 0 个；data-url 看着像直链（findermp.video.qq.com/.../stodownload），实际返回 540×720 封面 JPEG（27KB，Content-Range 全长就是 27060），换桌面 UA / 微信 UA / 加 Referer 三次都返回同一张 jpg；页面里 channels.weixin.qq.com、weixin://、shareUrl、mpvideo.qpic.cn 全部 0 命中，只有 export_id（视频号内部 objectId）和 CGI 名单里的 mp/appmsg_video_snap。真实流要带微信登录态调接口且分片加密，扩展拿不到。
4.修法：MEDIA_SEL 补 mp-common-videosnap / videoplayer / videobox；PLAYER_WRAP_SEL 与 PLAYER_CHROME_SEL 补 .channels_iframe_wrp / .channels_iframe / .videosnap_video_iframe；readAttachment 在开头先向下找 SNAP_SEL 本体，命中就走 readVideosnap——不给假的直链，只指回原文，label 写成「视频（视频号 · 新华社）」，data-type=live 时写「直播（视频号直播 · 昵称）」。
5.定位为什么不用 #hash / #:~:text=：微信页面在加载后约 300ms 内 replaceState 把 hash 抹掉。实测（无头 Chrome + 有界面 Chrome 各一轮）：Page.navigate 到带 #:~:text= 的地址，400ms 时 location.href 已经不含 fragment，4s 后 scrollY 仍是 0，videoTop 还是 2695。#js_content 这种普通锚点只滚到正文顶部（scrollY 117），同样没用。所以放弃浏览器自带机制。
6.定位改用 query：?wxmd_video=N。实测参数一直保留（300ms / 1200ms / 4000ms 三次采样都在），文章正常加载。N 是「视频号卡片」在正文里的序号，按 DOM 顺序、不分 video / live 一起数，在嵌套去重之后统一赋（早赋会因去重错位）。
7.扩展侧：floating.js 新增 scrollToVideoFromUrl()，跑在文章页判断之后。读 wxmd_video，按同一个选择器取第 N 个卡片，滚到「卡片顶部 - max(72px, 视口 10%)」。分 0/600/1500/3000ms 四轮校正（图片懒加载会边滚边撑高），已在位置附近（±40px）就不动，用户一滚滚轮 / 触摸就彻底交出控制权。
8.实测：?wxmd_video=1 打开文章，滚到 2605，卡片 top=90 / bottom=677，视口 900，完整可见；后三轮都是 already（没有抖动）。
9.兼容：没装扩展时这个参数完全无害，微信照常打开文章，只是不定位；appendQuery 会把参数插在 #wechat_redirect 之前，带 __biz 的长链也照常可用。手机微信内置浏览器同样只是不跳。
10.实测输出（目标文章）：2359 字符 / 6 图，视频行是 [视频（视频号 · 新华社）](https://mp.weixin.qq.com/s/hX_WmYpYDJAo3y5C-zQAAg?wxmd_video=1)。
11.回归：live / live1~6 / q887 八篇与改动前逐字一致；z4 仍 15 图 / 1367 字符；表格文章 3558 字符 / 16 图 / 6 张表。自营视频（videosnippet）那条老路径不动，仍给 view_player_tmpl 可播放页。
12.测试：新增 6 个夹具（单个卡片、多个顺序编号、live、带 #wechat_redirect 的参数拼接、卡片 UI 文案不漏、自营视频不带参数），npm test 37 项全绿。
13.node --check 全部通过，npm run pack 打包通过（产物已删）。
AS.定位等待放长 + 失效可诊断（v16.28.0）：
1.症状：用户打开带 ?wxmd_video=1 的文章链接后，页面没有滚到视频位置，也没有任何提示。
2.根因（不是代码）：Chrome 里装的仍是 1.16.26.0。未打包扩展改完文件不会自动生效——实测：只改 floating.js 的滚动偏移（72 → 300），不点重载，新开标签页仍然读出旧的 72px 偏移，说明内容脚本读的是加载时缓存的那份。Secure Preferences 里 service_worker_registration_info.version = 1.16.26.0 也能对上。处理办法：chrome://extensions 里点该扩展的「重新加载」，版本号应变为 1.16.28.0。
3.等待策略放长：原来只在 0/600/1500/3000ms 四轮里找卡片，弱网或冷启动时卡片 3 秒后才挂进 DOM 就会彻底放弃。改为 3 秒内照旧做四轮漂移校正；3 秒没定位到就继续在 5000 / 8000 / 12000ms 补找，但已经定位成功过就不再动（避免用户读着读着被拽回去）。
4.交互判定补 pointerdown：拖滚动条、点选文字不触发 wheel / touchmove，以前会被当成「用户没动」，现在同样交出控制权。
5.诊断：12.5s 仍未定位到，控制台留一行 [wx-md] 告警，区分「页面上压根没有视频卡片元素」和「有 N 个但序号超范围」，不用再靠猜。
6.验证：干净配置里用 CDP（Extensions.loadUnpacked）装载本扩展后打开该链接，scrollY 0 → 2269 → 2614，卡片 top 2695、视口 900，稳定不抖；改动前后同一路径逐字节对比无差异。
AT.Chromium 全系安装包 + 新版本提醒（v16.29.0）：
1.Chromium 系的兼容结论是「不用改代码，只缺一个能上商店的产物」：原来 npm run pack 只出 crx（本机双击安装用），而 Chrome Web Store / Edge Add-ons / Opera Add-ons 只收 zip。新增 tools/build.js（npm run build），产出 dist/chromium/（解压即装）与 dist/wxmd-<版本>-chromium.zip（三店通用）。zip 由内置的最小 zip 写入器生成（Node 没有内置 zip），文件名按 UTF-8 标记（0x0800），中文路径不会乱码。
2.打包前自检：manifest_version 必须是 3、必须有 background.service_worker、必须有 minimum_chrome_version（否则旧内核装上去是静默报错）；lib/defaults.js 与 lib/update.js 里若还留着 yourname 占位地址会打一行提醒，不阻断打包（本地自用可以先不管）。
3.新版本提醒（默认关闭）：配置页新增「版本与更新」卡片，开关 updateNotify 默认 false。关着的时候后台一次网络请求都不发，这也是「不联网、不上传」那句话能继续成立的前提。
4.检查链路：background 用 chrome.alarms 建 wxmd-update-check，周期 1440 分钟（MV3 后台的 setTimeout 会随 worker 回收丢失，必须用 alarms）。装好 / 每次启动浏览器各查一次，开关状态变化时立即生效。lib/update.js 的 check() 只做 fetch + 解析 + 比版本，失败一律返回 ok:false，从不 reject。
5.比版本号不能用字符串：'1.16.9' > '1.16.28' 在字典序下成立，会天天提示有新版本。改为按 . 切段比数值，位数不齐补 0（1.16.29 == 1.16.29.0），带 -beta 后缀的低于同号正式版。
6.节流：成功结果 24 小时内不重复查；失败只记 lastFailAt 并保留上一次的成功结果（断网不该把已知的新版本信息抹掉），1 小时内不重试。请求带 t=<时间戳> 绕 CDN 缓存，改了 version.json 立刻生效。
7.不新增 host_permissions：version.json 靠服务端 Access-Control-Allow-Origin: * 放行，避免商店多一条权限弹窗。代价是托管方必须带这个响应头，README 已写明。
8.提醒落点三个：工具栏角标 NEW（有新版且没被忽略）、配置页横幅（版本号 + 更新说明 + 去更新 + 忽略此版本）、弹窗顶部一条窄提醒条。都没碰浮窗的 closed shadow DOM。
9.「忽略此版本」只写 updateSkipVersion，压下角标和横幅，不影响继续检查更新的版本；装了新版后旧记录里的 hasUpdate 会失效，所有渲染处一律用当前 manifest 版本现算，不直接信存储里的 hasUpdate。
10.边界写清楚：扩展不会自我安装，Chrome/Edge 商店版的更新由浏览器完成，离线包用户要手动换包。配置页文案直接写「安装由商店或你自己完成」，不承诺做不到的事。
11.验证（真实 Chrome + CDP Extensions.loadUnpacked 装载 dist/chromium）：配置页显示当前版本 1.16.29.0、开关默认 false、状态「尚未检查」；页面内直连本地 HTTP 服务验证三条分支（有新版 has=true 且取到 chrome 地址、同版本 has=false、404 返回 error）；写入 updateLatest 后配置页显示「发现新版本 v1.16.30.0（2026-12-01）」+ 两行说明 + 去更新按钮；点忽略后变「已忽略」且说明隐藏；弹窗横幅出现 v1.16.30.0，关开关后消失；后台 alarm 1440 分钟随开关建立/清除，角标 NEW 同步出现/清空，占位地址检查失败只写 lastFailAt、无异常抛出。
12.测试：新增 test/update.test.js 12 项（版本比较含字典序陷阱、位数补齐、预发布、normalize、有新版本/同版本/更旧、缓存参数拼接、404/非 JSON/缺版本号/抛异常、未配置地址不发请求、顶层 url 写法、成功与失败两套节流），npm test 49 项全绿。
13.node --check 全部通过（新增 lib/update.js 已加入 npm run check），npm run build 产出 26 个文件 / 194KB zip，Expand-Archive 解压后与源文件逐字节一致。
BD.顶部信息卡展开不再压住旁边的卡（v16.39.0）：
1.症状：上一版（BC）的 L 形展开是「内容区宽 200% + 间距，直接铺到旁边那张卡上面」。视觉上两张卡的边框压在一起——旁边那张卡的左边框从展开区里穿出来、展开体右上角被压掉一块。用户反馈「太丑」，并要求展开内容不要与标题栏直接相连、宽度要和其他配置卡一致。
2.根因：内容区在同一网格行内用 width + 负 margin 溢出，位置只能靠百分比猜；旁边那张卡仍在第 1 行原位，两者必然重叠。z-index 只能决定谁盖谁，不能消除边框穿插。
3.改法：内容区从「同行溢出、跨两列」改成「另起一行、占满整行」。.top-cards > .notice-card 用 display: contents 退成透明容器，让 .collapsible-head 与 .collapsible-body 各自作为 grid item：head 在第 1 行（col 1 / col 2 / nav col 3），body 在第 2 行 `grid-column: 1 / -1`。宽度交给网格算，与下方配置卡左右边界一致（实测都是 216–968，752px）。
4.间距：去掉上一版的 `margin-top: -16px`，直接用 row-gap 的 16px。body 恢复完整圆角和四边框，成为一张独立的卡；head 也不再让出底边，收起/展开都是完整圆角。
5.删掉的临时代码：body 的 `::before` 顶边补线、head 展开态的 `border-bottom-color: transparent` 与下圆角清零、兄弟卡的 .dim 类（原来用来去掉下圆角）——不再需要，全部移除。
6.展开反馈：`.top-cards > .notice-card.open > .collapsible-head` 描边改为 --brand-green，收起后恢复，保证「点开的是哪张」和下面弹块对得上。
7.互斥：两张卡的 body 都在同一个网格格里，同时展开会叠在一起。折叠逻辑保留 TOP_CARD_HEAD 映射，展开前先把另一张收起（上一版允许同时展开）。
8.窄屏：≤900px 仍走单列，卡本体恢复 display: block，body 用 margin-top: 12px 与标题卡分开。
9.验证（headless Chrome + chrome API stub）：左/右展开时 body 都是 [216, 968, 752]，与紧随其后的配置卡矩形完全一致；收起态 body 不占位；三块头部 282/282/156 等高；820px 单列正常无溢出。
10.顺带：head padding 14/16，body padding 16/20/18，阴影 `0 14px 30px -10px`，版本 1.16.38.0 → 1.16.39.0。
BE.顶部三条信息改成同一张卡里的分组行（v16.40.0）：
1.症状：BD 版把两个标题栏并排放在第 1 行、展开内容横跨整行放在第 2 行。缝没有了、宽度也全宽了，但「归属」看着别扭——整宽面板压在两个标题栏下面，既不属于左边也不属于右边；面板右上角还悬着另一张不相干的卡（截图里两块红色区域就是这两处）。
2.根因：两列布局 + 单列面板本身就是几何冲突。只要标题栏是「半宽并排」，而内容区是「整宽」，两者之间必然有一段对不上的边界；靠 margin / 负位移 / 圆角补丁只能糊，糊不平。
3.改法：放弃并排。整个顶部区域收成**一张卡里的三行**：`.top-cards` 变成普通卡（白底 + 12px 圆角 + 1px 边），内部 `.notice-card` 退成透明容器（display 从 contents 改回 block，padding/border/background/radius 全部清零），head 与 body 都变成行内元素。
4.CSS 全部从「网格 + 跨列」改成「纵向列表」：删掉 grid-template-columns / grid-row / grid-column / nth-child 定位 / 200% 宽度 / 负位移 / ::before 补线；新增 `.top-cards > * + *` 的行间发丝线（#f0f2f4）、head 的 hover 与 open 态背景（#F7FDFA）、body 的左缩进 26px（图标 18 + gap 8，正好对齐标题文字）。
5.展开态即「整行浅绿带」：head 与 body 同为 #F7FDFA、body 的 margin-top 归零（覆盖 `.notice-card .collapsible-body` 的 12px），标题和内容视觉上连成一块，但仍能看出是哪一行展开的。
6.导航行（链接导出）从竖排小卡改成标准列表行：logo + 标题在左，进度角标 + 箭头在右；hover 时整行浅绿、箭头右移 2px 并变绿。HTML 里 `.nav-top` 包裹层拆成 `.nav-left` / `.nav-right`。
7.角标（var-badge）在 `.top-cards` 内改成浅绿胶囊（--brand-green-light + 透明边），白底行上不再像一块浮起来的白片。
8.交互仍为手风琴：`.open` 同时记在 head 与 .notice-card 上（描边/背景用），互斥逻辑保留在 options.js 的 TOP_CARD_HEAD；上一版的 .dim（去下圆角）已随之删除，无需再改。
9.窄屏（≤900px）：结构不变，只把 head/body/nav 的左右 padding 收到 15px、body 左缩进收平（44 → 15），避免小屏上正文被挤成窄条。顺手修掉 560px 下底部「恢复默认」被压成两行：`.footer-actions` 加 flex:0 0 auto，按钮加 white-space:nowrap。
10.验证（headless Chrome + chrome API stub，1000px 与 560px 两种宽度）：分组外框 [116, 868, 752] 与下方「保留在线链接配置」卡片矩形完全一致；三行分别 750×50 / 750×50 / 750×49（含 1px 分隔线等高）；展开体 750×223（说明）/ 750×209（更新），左右边界与卡片内边缘对齐，窄屏无溢出、无截断；点击顺序 open1 → open2 → close2 → open1b，最终只有一行带 open 类，无残留 .dim。版本 1.16.39.0 → 1.16.40.0。
BF.「返回配置」不再原地再开一个配置页（v16.41.0）：
1.症状：链接导出页是 target=_blank 打开的新标签，左上角「返回配置」是 `<a href="options.html">`。点下去是在当前标签里导航到配置页——于是浏览器里出现第二个配置页，用户原来那个还留在后台，感觉「返回」没回到原处。
2.根因：普通链接无法表达「回到来源标签」。新标签的返回语义需要 tabs API：找到来源 tab、激活它、再关掉自己。
3.做法（queue.js）：click 事件里 preventDefault，然后按优先级找目标 tab——(a) `tabs.getCurrent()` 拿到的 openerTabId 对应的标签，且它的 URL 是配置页；(b) 任意一个 URL 是配置页的标签，按「当前可见 → lastAccessed 最近」排序取第一个。命中后 `tabs.update({active:true})`、`windows.update({focused:true})`、`tabs.remove(自己)`。两条都不命中才 `location.href='options.html'`，保留手输地址打开时的可用性。
4.让 (a) 成立：options.js 点「链接导出」时改用 `chrome.tabs.create({ url, openerTabId: 当前标签 })`，不再依赖 `<a target="_blank">` 的隐式关系（JS 读不到）。
5.顺手治理多开：点入口时先 `tabs.query` 扩展页面，已经有队列页就 `tabs.update` 切过去而不是再开一个；查询/创建都不可用时（老环境、测试桩）在 handler 开头直接 return，保留 `<a>` 的默认行为。
6.防死按钮：两处都包在 try/catch 里，异常走兜底（原地跳转 / window.open），不会点了没反应。
7.验证（headless Chrome 加载真实的 queue.js / options.js + chrome API stub，记录调用序列）：
   - 有 opener：`getCurrent → get:3 → update:3(active) → windows.update:1 → remove:7`，没有多余 query；
   - opener 已关、仍有配置页：`getCurrent → query → update:3 → windows.update:1 → remove:7`；
   - 配置页全关：原地导航到 options.html（页面标题变为「详细配置」）；
   - 入口点击：已有队列页时 `query → update:9`，没有时 `query → getCurrent → create opener=5`。
8.版本 1.16.40.0 → 1.16.41.0。
BG.两块低频信息挪到页面底部（v16.42.0）：
1.动机：BE 版把「导出位置说明 / 版本与更新 / 链接导出」塞进首屏同一张卡。首屏一行三块看着整齐，但「版本与更新」「链接导出」其实很少点，且与「导出与命名规则」无关，占着最贵的位置。
2.改法：`.top-cards` 拆成两处组卡——顶部只留「导出位置说明」一行；「版本与更新」卡与「链接导出」行整体搬到 `.layout` 末尾，紧跟「可用变量」卡之后，共用 `.row-group` 样式（选择器由 .top-cards 全量改名，样式一行没改）。
3.互斥取消：原来两张卡共用一个展开位，才需要手风琴互斥；现在两块分处首尾，隔好几屏，自动收起对方只会让人莫名其妙。options.js 里删掉 TOP_CARD_HEAD 映射与「展开前先收起另一张」的分支，只留最朴素的 toggle。
4.结构校验：`row-group` 计数 2；顶部组 1 行、高 52；底部组 2 行、高 101；底部组 top≈1643（容器滚动区内），前面紧邻「可用变量」卡。
5.截图核对（headless Chrome + chrome API stub，1000×880）：顶部单行卡、展开态；底部两行卡收起与展开态；行间发丝线、展开区浅绿带、正文缩进 44px 均正常，底部栏不遮挡（容器内滚动）。
6.版本 1.16.41.0 → 1.16.42.0。
BH.弹窗底部链接行上下等距（v16.43.0）：
1.症状：弹窗底部「官网 / 问题反馈」一行看着"下面空一块"。量出来文字上方 10px、下方 16px，且这一行带了 margin-top:-2px 与 padding-top:4px，本来是为了"压紧"，实际只是把上方挤紧、下方不动。
2.改法：(a) `.footer-links` 去掉 `margin:-2px 0 0` 与 `padding-top:4px`，改成 0；(b) `.app-container` 的 padding 由 `16px` 改成 `16px 16px 8px`，只有底边变薄。上方间距继续由 `.actions` 的 gap:8px 提供，下方由容器底内边距提供，两侧都是 8px。
3.为什么不给 footer 加负 margin-bottom：`.actions` 的负外边距会与 `#status` 的 `margin-top:8px` 折叠，状态文案出现时会贴到链接行上。改容器内边距没有这个问题。
4.实测（headless Chrome + chrome API stub，352px 宽）：链接盒 [462,480] 高 18，容器底 488 → 上 8 / 下 8；容器总高 498 → 488，弹窗矮 10px。带状态文案时 footer→status 8、status→底边 8。
5.版本 1.16.42.0 → 1.16.43.0。
BI.标题按模板取，别再只认 #activity-name（v16.44.0）：
1.症状：用户反馈 https://mp.weixin.qq.com/s/z4ujxrVatZ7kK_iAb6Ev5Q 导出后没有标题。正文、图片都正常，只有标题丢。
2.定位：抓该页（curl 2.9MB + headless Chrome 各一份）确认是「新版分享页」：body 带 page_share_img，容器 #js_base_container.share_content_page_bd，正文 #js_content > #js_image_content.image_content；标题只在 <h1 class="rich_media_title">，全页 0 个 #activity-name。原始 HTML 的 <title> 只有换行，由页面脚本 __setTitle(showTitle, itemShowType) 渲染后才写入；head 里已有服务端给的 og:title。
3.根因：旧逻辑是 `#activity-name → document.title`。这类页面第一档没有、第二档在注入时可能还是空串（<title> 空、由脚本后写），于是标题为空，而正文因为 #js_content 已渲染所以导出"成功"——症状看起来像标题识别问题，其实是模板差异。
4.做法：lib/defaults.js 新增 WXMD_pickTitle(doc)，按 #activity-name → h1.rich_media_title → #js_text_title → #js_video_page_title → #js_audio_title → .rich_media_title → meta[og:title]/twitter:title → document.title（剥「微信公众平台」后缀）取第一个非空；文本统一 \s+ 折叠。用 textContent 而不是 innerText：后台标签页没有布局，innerText 可能算不出来。
5.调用点统一：content.js（YAML / {{title}} / 文件名）、floating.js（浮窗标题）、popup.js（弹窗「当前文档」的标题，注入函数里 typeof 判断，页面未注入 lib 时回退旧逻辑）。content.js 的 TITLE_SELECTOR 只留在降级分支里。
6.验证：把真实页面 dump 到本地（.tmp，已清理），在 headless Chrome 里按 injectlist 顺序加载真实 lib + content.js。三种变体各跑一次：原样 → 取 document.title；清空 <title> → 取 h1；再删掉 h1 → 取 og:title；都得到「5GB永久免费虚拟主机，不绑卡不限流量」，YAML title 同步。test/content.test.js 新增 5 项（h1 兜底、og:title、document.title 去后缀、优先级、js_*_title），88 项全绿。
7.顺带记一笔：队列列表在跑完之前显示的是链接尾巴（queue.js 的 shortUrl），不是标题，容易被当成「标题没识别」。
8.版本 1.16.43.0 → 1.16.44.0。
BJ.链接导出图片消息取不到图 / 队列限流提示（v16.45.0）：
1.症状：https://mp.weixin.qq.com/s/z4ujxrVatZ7kK_iAb6Ev5Q 用浮窗导出有 15 张图，用「链接导出」跑出来 0 张。
2.定位（headless Chrome + CDP，同一页面两种标签状态）：
   - 前台与后台标签的 `#img_list` 都只挂 **1** 个 `.swiper_item`，且是 `<div class="swiper_item">` 空壳（无 data-src，内层 img 是 `tp=webp&usePicPrefetch=1` 的副本）；
   - `window.cgiDataNew.picture_page_info_list` 稳定 15 条（`item_show_type=8` 即图片消息），`window.picture_page_info_list` 被 `slice(0,20)` 截过；
   - 用真实 DOM 跑 content.js：前台 dump 能取 15 张（--virtual-time-budget 把轮播推完了），后台标签 0 张。
   结论：轮播是虚拟渲染，能拿几张取决于视口与渲染进度，不能当数据源；BI 条修的是同一根因的另一面（标题也只有脚本渲染后才写进 <title>）。
3.难点：全量图集在页面全局，而 `chrome.scripting.executeScript` 注入的 content.js 跑在 isolated world，`window.cgiDataNew` 读到的是 undefined。
4.做法：background 的 `bridgePictureList(tabId)` 在 waitTabComplete 之后、注入 content.js 之前，用 `world:'MAIN'` + `func` 读一次图集，去重（按 path）后写进 `<html data-wxmd-pics>`。只在确认是图片消息时才写（`item_show_type === 8` 或页面有 `#js_image_content / #js_image_desc`），避免普通图文里万一带了同名列表被硬塞进正文。lib/imagepost.js 的 `takeBridged()` 读该属性、读完立即删除，`prepare()` 里 `bridged.length ? bridged : collectUrls(doc)`。DETECT_SEL 判定也放宽成「有桥数据就不再要求 DOM 锚点」——后台标签连 `#js_image_content` 都可能还没挂上。注入失败（老浏览器 / 页面拒绝）整段 catch 掉，退回原来的 DOM 采集。浮窗/弹窗那条注入路径也调一次，两条入口取图一致。
5.地址清洗：页面里存的是被转义的 `&amp;`，桥的两侧都还原一次（background 写入前、imagepost 读取后），否则下载 404。
6.验证（后台标签 `background:true`，真实页面 + 真实 lib + content.js）：
   - 无桥：success true / images 0 / md 1005 字节；
   - 有桥：bridged 15 / images 15 / md 1250 字节且含 `![](...)`，正文仍在图片之前；
   - 图集桥读完即删：`documentElement.getAttribute('data-wxmd-pics')` 为 null（新增单测覆盖）。
7.队列上限：`MAX_ITEMS` 50 → 5000（防误贴硬顶，非业务上限），跳过原因改成「一次最多 5000 条，请先清空已完成的」；新增 `RISK_WARN_ITEMS = 200`，queue.js 用同一常量（queue.html 补引入 lib/queue.js，避免两份阈值）。
8.提示交互：待导出（queued + running + 本次新增）> 200 时 `confirm` 一次，取消则中止；`renderQueue` 在总数 > 200 时显示常驻橙色提醒。用待导出数而不是 total，续跑不会被已完成的历史条目反复弹窗。
9.耗时口径更正：10s/篇 × 500 ≈ 1.4 小时（用户算法正确）。此前给 2–3 小时是按 15–20s/篇的保守值。实测单篇加载 0.3–2s（缓存命中 0.3s 级）、图片并发 4 张/轮，常见文章 3–8s，500 篇顺跑约 40–70 分钟；唯一不可控项是加载超时（20s）后的重试。
10.测试：test/queue.test.js 上限用例拆成「300 条全进」+「硬顶拒绝」两项；test/content.test.js 新增「轮播只渲染 1 项时用图集桥取全 15 张」「桥读完即删」，helpers.render 支持 `opts.htmlAttrs`。91 项全绿。
11.版本 1.16.44.0 → 1.16.45.0。

BL.发布时间支持自定义格式（v16.46.0）：

1. 问题：`{{published}}` 直接取 `#publish_time` 的 innerText 原文，实际是 `2026年11月16日 10:00` 这种带中文的字符串，落到文件名还要被清洗成 `2026年11月16日_10_00` —— 又长、又不能按日期排序、还没法只取年月建目录。
2. 做法：新增 `{{published:格式}}`，格式解析复用 `formatMoment`，与 `{{date:格式}}` 是同一套标记（YYYY / YY / MMMM / MMM / MM / M / DD / D / Do / dddd / ddd / dd / HH / hh / mm / ss / A / a，`[...]` 原样输出）；替换用 `/\{\{published(?::([^}]+))?\}\}/g`，不带 `:格式` 时仍走原来的 `sanitizeName(m.published)`。
3. 为什么不改默认值：`{{published}}` 的「原文」是历史行为，改默认会让老用户已经建好的文件夹名整体变形，属于静默破坏。要规整格式就显式写 `{{published:YYYYMMDD}}`。
4. 解析器 `parsePublishedDate()`（lib/naming.js）按「年月日分隔符」宽匹配，认 `2026年11月16日 10:00` / `2026年11月16日` / `2026-11-16 10:00` / `2026/11/16` / `2026.11.16` / 紧凑 `20261116`（左右必须非数字，避免从 id、时间戳里截出 8 位）/ 全角数字；时间部分 `HH:mm[:ss]` 可选，缺省 0。
5. 校验：月 1–12、日 1–31、时 0–23、分秒 0–59，再回读 `getFullYear/getMonth/getDate` 与输入比对 —— 否则 `2026年2月30日` 会被 `new Date` 静默进位成 3 月 2 日，生成一个不存在的日期。
6. 兜底：解析不出来（`昨天`、`3 天前`）时 `{{published:格式}}` 渲染成空串 —— 宁可少一段，也不要错的日期；不带格式时照旧显示原文。
7. 路径模板里 `{{published:YYYY/MM}}` 与 `{{date:YYYY/MM}}` 行为一致，照常分子目录；文件名模板里 `/` 仍被清洗成 `_`。
8. 未做：共享文件夹模板（`resolveDateOnlyTemplate`）仍只放行 `{{date}}` / `{{time}}`，`{{published}}` 会被抹掉 —— 那块的口径是「同一批文章落在同一个稳定目录」，发布时间逐篇不同，放进去等于把共享目录按篇拆散。
9. 界面：变量表新增 `{{published:x}}` 一行（14 → 15 个变量），`{{published}}` 的说明补上「取页面原文」；「日期格式标记」小标题加上 `{{published:格式}}`。
10. 测试：test/paths.test.js 新增 6 项（多形态解析、非法值、原文不变、格式标记、解析失败为空、路径分子目录），共 97 项。
11. 版本 1.16.45.0 → 1.16.46.0。
12.补充（同日）：微信发布时间只到分钟，`ss` / `s` / `SSS` 用在 `{{published:格式}}` 上恒为 `00` / `0` / `000`，写 `{{published:HHmmss}}` 会得到 `100000` 这种看着像 bug 的结果。行为本身是对的（解析器按原文给秒，原文没有就补 0），问题在文档没交代，界面「日期格式标记」补一行说明，变量表 `{{published:x}}` 的说明加上「微信只给到分钟」。

BM.链接导出页右下角返回（v16.47.0）：

1. 问题：队列页只有左上角一个「返回配置」。虽然 `.topbar` 是 `position:sticky`，视觉上一直在，但手停在队列底部时还是要移动鼠标到左上角（长列表还得先滚回去），动线太长。
2. 做法：`.back-fab` 固定右下角（`position:fixed`），`window.scrollY > 160` 时加 `.show` 类淡入。默认 `opacity:0; pointer-events:none`，所以不显示时也不会截住鼠标事件。回到顶部自动收起，避免和顶部入口同时出现两个「返回」。
3. 返回逻辑没有复制一份：把原来的匿名 click 处理抽成 `goBackToOptions(e)`，`#backToOptions` 与 `#backToOptionsFab` 共用。三段式回落（openerTabId → 任意配置页 → 原地跳转）原样保留。
4. 遮挡问题：`.container` 的底部留白 40 → 76px（移动端 72px），浮动按钮不会压住列表最后一行。实测 30 条队列滚到底，卡片底边与按钮之间仍有余量。
5. 验证（headless Chrome + chrome API stub，30 条队列把页面撑到 1614px）：
   - 顶部 scrollY=0 → `class=back-fab`、opacity 0、pointer-events none；
   - 滚到 809 → `class=back-fab show`、opacity 1、pointer-events auto；
   - 点击调用序列 `get:3 → update:3{active} → windows.update:1{focused} → remove:7`，与左上角入口一致。
6. 版本 1.16.46.0 → 1.16.47.0。
