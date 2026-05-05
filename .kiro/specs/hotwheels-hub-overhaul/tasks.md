# 实施计划：Hot Wheels Hub 全面重构

## 概述

将现有的单体抓取脚本拆分为模块化架构，修复所有数据质量问题，新增搜索和新模具展示功能，统一本地与线上数据路径，简化 CI/CD 流程。按依赖关系从底层工具模块开始，逐步构建到抓取模块、前端功能，最后整合部署。

## 任务

- [x] 1. 搭建测试框架与项目基础设施
  - 安装 `vitest` 和 `fast-check` 作为开发依赖
  - 在 `package.json` 中添加 `test` 脚本（`vitest --run`）
  - 创建 `vitest.config.js` 配置文件
  - 创建 `scripts/lib/` 目录结构和 `tests/` 目录结构
  - 在 `package.json` 中添加 `build` 脚本（将 `site/` 和 `_data/` 组装到 `_site/`）和 `dev` 脚本（先构建再启动本地服务器）
  - _需求: 5.4, 5.5_

- [x] 2. 实现文本清洗模块 (`scripts/lib/text-cleaner.js`)
  - [x] 2.1 实现 `removeTemplates(text)` 函数
    - 使用迭代方式从最内层开始移除 `{{...}}` 模板
    - 每次迭代移除最内层 `{{[^{}]*}}`，最多迭代 10 次
    - 超过 10 次则强制移除所有残留 `{{` 和 `}}`
    - 正确处理包含管道符 `|` 的模板参数
    - _需求: 2.3, 13.1, 13.2, 13.3, 13.4_

  - [x] 2.2 实现其余清洗函数
    - `convertWikiLinks(text)`: `[[Page|Display]]` → `Display`, `[[Page]]` → `Page`
    - `removeExternalLinks(text)`: `[http://url text]` → `text`
    - `removeHeadings(text)`: 移除 `==...==` 标题标记
    - `removeHtmlAndFormatting(text)`: 移除 HTML 标签和 `''`/`'''` 格式标记
    - `removeTables(text)`: 移除 `{|`、`|-`、`|}` 表格标记
    - `cleanWikiText(text, maxLength)`: 依次执行所有清洗步骤，在句子边界截断
    - `extractDescription(wikitext, maxLength)`: 跳过 infobox，提取正文前几句
    - 导出所有函数
    - _需求: 2.1, 2.2, 2.4, 2.5, 2.6, 2.7_

  - [ ]* 2.3 编写属性测试：Wiki 文本清洗完整性
    - **Property 3: Wiki 文本清洗完整性**
    - 使用 fast-check 生成包含各种 Wiki 标记的随机文本
    - 验证输出不包含任何 Wiki 标记（标题、链接、模板、HTML、格式、表格、外部链接）
    - 验证 `[[Page|Display]]` 的显示文本保留在输出中
    - **验证需求: 2.1, 2.2, 2.3, 2.4, 2.5, 2.7, 13.1, 13.2, 13.3, 13.4**

  - [ ]* 2.4 编写属性测试：文本截断在句子边界
    - **Property 4: 文本截断在句子边界**
    - 使用 fast-check 生成随机长度的纯文本字符串
    - 验证超过 400 字符的文本截断后长度 ≤ 403 且以 `...` 结尾
    - 验证 ≤ 400 字符的文本保持不变
    - **验证需求: 2.6**

- [x] 3. 实现图片工具模块 (`scripts/lib/image-utils.js`)
  - [x] 3.1 实现图片工具函数
    - `isPlaceholderImage(url)`: 检查 URL 是否包含 `Image_Not_Available`（不区分大小写）
    - `getBestImage(parsed, wikiClient)`: 从页面数据中获取最佳非占位图，返回 `{ thumbUrl, fullUrl }` 或 `null`
    - `normalizeImageUrl(url, width)`: 清理 Vignette CDN URL，确保获取指定宽度缩略图
    - 导出所有函数
    - _需求: 1.1, 1.3, 1.4, 1.5, 1.6_

  - [ ]* 3.2 编写属性测试：占位图检测与过滤
    - **Property 1: 占位图检测与过滤**
    - 使用 fast-check 生成随机 URL，部分包含 `Image_Not_Available`
    - 验证 `isPlaceholderImage()` 返回值与 URL 是否包含该子串一致
    - **验证需求: 1.1, 1.5**

  - [ ]* 3.3 编写属性测试：图片回退与双 URL 输出
    - **Property 2: 图片回退与双 URL 输出**
    - 使用 fast-check 生成随机图片列表（混合占位图和真实 URL）
    - 验证返回第一张非占位图的 `{ thumbUrl, fullUrl }` 对
    - 验证全部为占位图时返回 `null`
    - **验证需求: 1.3, 1.4, 1.6**

- [x] 4. 实现安全写入模块 (`scripts/lib/safe-writer.js`)
  - [x] 4.1 实现 `safeWriteJSON(filePath, data, label)` 函数
    - 空数组：跳过写入，返回 `{ written: false, warning: '...' }`
    - 数量 < 已有文件的 50%：写入但返回非空 `warning`
    - 正常情况：写入且 `warning` 为 `null`
    - 写入前读取已有文件条目数量进行比较
    - _需求: 7.1, 7.2, 7.3_

  - [ ]* 4.2 编写属性测试：安全写入保护
    - **Property 8: 安全写入保护**
    - 使用 fast-check 生成随机 `(existingCount, newData)` 组合
    - 验证空数组不写入、数量下降超 50% 有警告、正常无警告
    - **验证需求: 7.1, 7.2, 7.3**

- [x] 5. 实现 Wiki API 客户端 (`scripts/lib/wiki-client.js`)
  - [x] 5.1 实现 `WikiClient` 类
    - 封装 HTTP 请求、重试逻辑（429/5xx/超时）、重定向跟随
    - 实现并发控制（最多 3 个并发请求 + 每请求间隔 500ms）
    - 实现 `imageInfo` 结果缓存（同一次运行中避免重复请求）
    - 提供 `query()`、`parsePage()`、`search()`、`imageInfo()`、`categoryMembers()` 方法
    - 提供 `getStats()` 方法返回总请求数、缓存命中数、总耗时
    - `imageInfo` 请求使用 `iiurlwidth=1200`
    - _需求: 8.1, 8.2, 8.3, 8.4, 1.2_

  - [ ]* 5.2 编写属性测试：图片信息缓存
    - **Property 9: 图片信息缓存**
    - 使用 mock HTTP 验证同一文件名连续调用两次 `imageInfo()`，第二次为缓存命中
    - 验证总请求计数仅增加 1
    - **验证需求: 8.3**

- [x] 6. 检查点 - 确保所有底层模块测试通过
  - 确保所有测试通过，如有问题请询问用户。

- [x] 7. 实现各抓取模块
  - [x] 7.1 实现经典名车抓取 (`scripts/lib/scrapers/featured.js`)
    - 将原 `scrapeFeaturedCars()` 逻辑迁移到独立模块
    - 使用 `WikiClient` 实例替代直接 HTTP 调用
    - 使用 `text-cleaner` 清洗描述文本
    - 使用 `image-utils` 过滤占位图并获取最佳图片
    - 导出 `scrapeFeatured(wikiClient)` 函数
    - _需求: 1.1, 1.3, 1.4, 1.5, 1.6, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x] 7.2 实现新车速递抓取 (`scripts/lib/scrapers/releases.js`)
    - 合并原 `scrapeNewReleases()` 和 `scrapeReleases()` 逻辑
    - 对同一年度列表页仅解析一次（消除重复调用 `scrapeYearList()`）
    - 以 `pageName` 为去重键，保留首个拥有有效图片的条目
    - 使用 `text-cleaner` 和 `image-utils`
    - 导出 `scrapeReleases(wikiClient)` 返回 `{ releases, newReleases }`
    - _需求: 4.1, 4.2, 4.3, 8.1_

  - [ ]* 7.3 编写属性测试：发布数据去重
    - **Property 7: 发布数据去重**
    - 使用 fast-check 生成包含重复 `pageName` 的随机车型列表
    - 验证去重后每个 `pageName` 仅出现一次
    - **验证需求: 4.1, 4.2, 4.3**

  - [x] 7.4 实现系列数据抓取 (`scripts/lib/scrapers/series.js`)
    - 从 Wiki API 动态获取系列信息
    - 为每个系列生成正确的 Wiki 页面链接（如 `https://hotwheels.fandom.com/wiki/Car_Culture`）
    - 尝试获取代表性图片
    - Wiki 数据不足时使用预定义列表兜底，但仍生成正确链接
    - 保留中文描述
    - 导出 `scrapeSeries(wikiClient)` 函数
    - _需求: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [ ]* 7.5 编写属性测试：系列 Wiki 链接正确性
    - **Property 10: 系列 Wiki 链接正确性**
    - 使用 fast-check 生成随机系列名称
    - 验证生成的 URL 匹配 `https://hotwheels.fandom.com/wiki/{encoded_name}` 格式
    - **验证需求: 9.2**

  - [x] 7.6 实现新闻抓取 (`scripts/lib/scrapers/news.js`)
    - 在 `rcprop` 中包含 `ids` 以获取 `revid`
    - 使用 `revid` 生成 `rc_{revid}` 格式 ID，无 `revid` 时使用 `rc_{encodedTitle}_{timestamp}` 备用格式
    - 过滤空 comment 和机器人编辑条目
    - 过滤标题为 `List of YYYY Hot Wheels` 的条目
    - 优先使用页面首段描述作为摘要，替代 Wiki 编辑注释
    - 使用 `text-cleaner` 清洗摘要文本
    - 导出 `scrapeNews(wikiClient)` 函数
    - _需求: 3.1, 3.2, 3.3, 3.4, 10.1, 10.2, 10.3, 10.4, 10.5_

  - [ ]* 7.7 编写属性测试：新闻 ID 生成与唯一性
    - **Property 5: 新闻 ID 生成格式**
    - 使用 fast-check 生成随机 revid、标题、时间戳
    - 验证 ID 格式正确且仅包含 URL 安全字符
    - **验证需求: 3.2, 3.3**

  - [ ]* 7.8 编写属性测试：新闻 ID 批次唯一性
    - **Property 6: 新闻 ID 批次唯一性**
    - 使用 fast-check 生成包含重复元素的随机新闻批次
    - 验证所有 ID 互不重复（集合大小等于数组长度）
    - **验证需求: 3.4**

  - [ ]* 7.9 编写属性测试：新闻质量过滤
    - **Property 11: 新闻质量过滤**
    - 使用 fast-check 生成随机新闻条目（混合有效和无效条目）
    - 验证过滤后不包含空 comment 条目和 `List of YYYY Hot Wheels` 标题条目
    - **验证需求: 10.1, 10.2**

  - [x] 7.10 实现图片库抓取 (`scripts/lib/scrapers/gallery.js`)
    - 将原 `scrapeGallery()` 逻辑迁移到独立模块
    - 使用 `image-utils` 过滤占位图
    - 导出 `scrapeGallery(wikiClient)` 函数
    - _需求: 1.1, 1.5_

  - [x] 7.11 实现新模具抓取 (`scripts/lib/scrapers/new-castings.js`)
    - 从 Wiki 年度新模具列表页抓取数据
    - 提取车型名称、图片、设计师、首发系列
    - 输出为 `_data/new-castings.json`
    - 使用 `text-cleaner` 和 `image-utils`
    - 导出 `scrapeNewCastings(wikiClient)` 函数
    - _需求: 11.1, 11.2, 11.3_

- [x] 8. 重构入口文件 (`scripts/scrape.js`)
  - 重写 `scripts/scrape.js` 为编排入口
  - 创建共享的 `WikiClient` 实例，传入各抓取模块
  - 使用 `safe-writer` 写入所有 JSON 文件（包括 `new-castings.json`）
  - 在 metadata 中记录 `totalNewCastings`、`totalRequests`、`runTimeMs`
  - 所有类别抓取失败时以非零退出码终止
  - 输出总运行时间和总 API 请求次数
  - _需求: 7.1, 7.2, 7.3, 7.4, 8.4_

- [x] 9. 检查点 - 确保所有抓取模块测试通过
  - 确保所有测试通过，如有问题请询问用户。

- [x] 10. 实现前端搜索模块 (`site/js/search.js`)
  - [x] 10.1 实现 `SearchEngine` 类
    - `buildIndex(allData)`: 构建搜索索引，索引 featured、releases、new-castings、gallery 数据
    - `search(query, maxResults = 10)`: 将查询拆分为关键词，在名称和系列中进行 `includes` 匹配
    - 结果按匹配关键词数量降序排列
    - 每条结果包含 `name`、`image`、`category`、`url`、`sectionId`
    - _需求: 12.2, 12.4_

  - [x] 10.2 实现 `SearchUI` 类
    - 处理输入事件，300ms 防抖
    - 以下拉列表形式渲染最多 10 条结果
    - 点击结果滚动到对应页面区域或打开 Wiki 链接
    - 无匹配时显示"未找到相关车型"提示
    - _需求: 12.1, 12.3, 12.5, 12.6_

  - [ ]* 10.3 编写属性测试：搜索正确性与结果上限
    - **Property 12: 搜索正确性与结果上限**
    - 使用 fast-check 生成随机数据集和查询字符串
    - 验证结果数量 ≤ 10，且每条结果的 `name` 包含至少一个查询关键词
    - **验证需求: 12.2, 12.4**

- [x] 11. 更新前端页面
  - [x] 11.1 更新 `site/index.html`
    - 在导航栏中添加搜索输入框
    - 在导航栏中添加"新模具"入口链接
    - 添加新模具展示区域（section），位于"新车速递"之后
    - 引入 `js/search.js` 脚本
    - _需求: 11.4, 12.1_

  - [x] 11.2 更新 `site/js/app.js`
    - 添加加载 `new-castings.json` 数据
    - 添加 `renderNewCastings()` 渲染函数，以卡片网格展示新模具
    - 在 `init()` 中初始化搜索引擎（构建索引、绑定 UI）
    - 更新 `renderStats()` 包含新模具统计
    - _需求: 11.4, 11.5, 12.1, 12.2_

  - [x] 11.3 更新 `site/css/style.css`
    - 添加搜索框样式（输入框、下拉结果列表、结果项）
    - 添加新模具区域样式（卡片网格、卡片样式）
    - 添加搜索无结果提示样式
    - _需求: 11.5, 12.1, 12.6_

- [x] 12. 检查点 - 确保前端功能和所有测试通过
  - 确保所有测试通过，如有问题请询问用户。

- [x] 13. 更新 GitHub Actions 工作流
  - [x] 13.1 修改 `.github/workflows/scrape-and-deploy.yml`
    - 合并 `deploy` 和 `deploy-on-push` 为单一 deploy job
    - deploy job checkout 时使用 `ref: main` 并执行 `git pull` 获取最新数据
    - scrape job 使用 `npm install` 替代 `npm ci`
    - 使用 `npm run build` 替代内联 shell 构建命令
    - _需求: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x] 13.2 更新构建脚本确保 `new-castings.json` 也被复制到 `_site/data/`
    - 验证 `npm run build` 产物包含所有 JSON 文件（含 `new-castings.json`）
    - _需求: 5.2, 5.4, 11.3_

- [x] 14. 最终检查点 - 确保所有测试通过
  - 运行完整测试套件确保所有测试通过
  - 运行 `npm run build` 验证构建产物结构正确
  - 确保所有测试通过，如有问题请询问用户。

## 备注

- 标记 `*` 的子任务为可选任务，可跳过以加快 MVP 进度
- 每个任务引用了具体的需求编号以确保可追溯性
- 检查点任务用于阶段性验证，确保增量开发的正确性
- 属性测试验证设计文档中定义的 12 个正确性属性
- 单元测试验证具体场景和边界条件
