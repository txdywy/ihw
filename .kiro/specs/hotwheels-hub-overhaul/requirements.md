# 需求文档：Hot Wheels Hub 全面重构

## 简介

Hot Wheels Hub 是一个面向风火轮（Hot Wheels）收藏者的信息聚合网站。该项目通过自动化脚本从 Hot Wheels Fandom Wiki 抓取数据，生成静态网站并通过 GitHub Pages 部署。本次重构旨在全面修复现有的数据抓取质量问题、图片获取缺陷、前端数据路径错误、GitHub Actions 部署问题，并增强网站功能（搜索、新模具展示、动态系列数据），使其成为一个可靠、高质量的风火轮收藏者信息中心。

## 术语表

- **Scraper**：数据抓取脚本（`scripts/scrape.js`），负责从 Wiki API 获取数据并输出 JSON 文件
- **Wiki_API**：Hot Wheels Fandom Wiki 提供的 MediaWiki API（`https://hotwheels.fandom.com/api.php`）
- **Vignette_CDN**：Fandom Wiki 使用的图片 CDN 服务（`static.wikia.nocookie.net`）
- **Placeholder_Image**：Wiki 中名为 `Image_Not_Available.jpg` 的占位图片，表示该条目无可用图片
- **Data_Directory**：存放抓取结果 JSON 文件的目录（`_data/`）
- **Site_Directory**：存放静态网站源文件的目录（`site/`）
- **Build_Output**：构建产物目录（`_site/`），包含部署到 GitHub Pages 的最终文件
- **Frontend**：纯静态 HTML/CSS/JS 前端应用（`site/` 目录下的文件）
- **CI_Pipeline**：GitHub Actions 工作流（`.github/workflows/scrape-and-deploy.yml`）
- **Wiki_Markup**：MediaWiki 使用的标记语言，包含 `==标题==`、`[[链接]]`、`{{模板}}` 等语法
- **Infobox**：Wiki 页面中使用 `{{casting|...}}` 或 `{{Infobox_Car|...}}` 模板定义的结构化信息框
- **EARS_Pattern**：Easy Approach to Requirements Syntax，一种结构化需求书写方法
- **New_Casting**：风火轮新模具车型，指当年首次发布的全新设计车型
- **Dev_Server**：本地开发服务器，通过 `npm run dev` 启动，用于本地预览网站

## 需求

### 需求 1：图片抓取质量保障

**用户故事：** 作为风火轮收藏者，我希望网站展示的图片都是真实的高质量车型图片，而不是占位图或低分辨率缩略图，以便我能清晰地查看每款车型的外观细节。

#### 验收标准

1. WHEN Scraper 从 Wiki_API 获取到图片 URL 后，THE Scraper SHALL 检查该 URL 是否包含 `Image_Not_Available` 字符串，并丢弃所有匹配的 Placeholder_Image
2. WHEN Scraper 调用 `wikiImageInfo()` 获取图片信息时，THE Scraper SHALL 请求 `iiurlwidth` 为 `1200` 以获取更高分辨率的缩略图
3. WHEN 一个 Wiki 页面的主图为 Placeholder_Image 时，THE Scraper SHALL 尝试从该页面的 `images` 列表中查找下一张可用的非占位图片
4. THE Scraper SHALL 为每张图片同时存储缩略图 URL（`thumburl`）和原始图 URL（`url`），Frontend 列表页使用缩略图，灯箱大图使用原始图
5. WHEN Scraper 完成 gallery 数据抓取后，THE Scraper SHALL 验证最终结果中不包含任何 Placeholder_Image URL
6. IF 某个车型页面完全没有可用图片，THEN THE Scraper SHALL 在该条目中将 `image` 字段设为 `null` 而非使用 Placeholder_Image URL

### 需求 2：Wiki 文本清洗与描述提取

**用户故事：** 作为网站访客，我希望看到干净、可读的车型描述文字，而不是包含 Wiki 标记符号的原始文本，以便我能流畅地阅读内容。

#### 验收标准

1. THE Scraper SHALL 从提取的描述文本中移除所有 Wiki_Markup 标题标记（如 `==Description==`、`===Versions===`）
2. THE Scraper SHALL 将 Wiki 内部链接 `[[Page|Display]]` 转换为纯文本 `Display`，将 `[[Page]]` 转换为 `Page`
3. THE Scraper SHALL 移除所有 Wiki 模板标记 `{{...}}`，包括嵌套模板（如 `{{template|{{nested}}}}`）
4. THE Scraper SHALL 移除所有 HTML 标签（如 `<ref>...</ref>`、`<br/>`）和 Wiki 格式标记（如 `''斜体''`、`'''粗体'''`）
5. THE Scraper SHALL 移除 Wiki 表格标记（以 `{|`、`|-`、`|}` 开头的行及 `||` 分隔的单元格内容）
6. WHEN 清洗后的描述文本超过 400 个字符时，THE Scraper SHALL 在最近的句子边界处截断并追加省略号 `...`
7. THE Scraper SHALL 移除外部链接标记 `[http://... display text]`，仅保留显示文本部分

### 需求 3：新闻数据 ID 唯一性修复

**用户故事：** 作为开发者，我希望每条新闻数据都有唯一的标识符，以便前端能正确地渲染和更新新闻列表。

#### 验收标准

1. WHEN Scraper 通过 `recentchanges` API 获取新闻数据时，THE Scraper SHALL 在 `rcprop` 参数中包含 `ids` 以获取 `revid` 字段
2. THE Scraper SHALL 使用 `rc.revid` 生成格式为 `rc_{revid}` 的唯一 ID
3. IF `revid` 字段不可用，THEN THE Scraper SHALL 使用页面标题的 URL 安全编码加时间戳作为备用 ID（格式：`rc_{encodedTitle}_{timestamp}`）
4. THE Scraper SHALL 确保同一批次抓取的所有新闻条目 ID 互不重复

### 需求 4：发布数据去重

**用户故事：** 作为风火轮收藏者，我希望新车速递列表中每款车型只出现一次，而不是因为不同涂装版本而重复出现多次，以便我能快速浏览所有新车型。

#### 验收标准

1. WHEN Scraper 解析年度车型列表时，THE Scraper SHALL 以车型页面名称（`pageName`）作为去重键，同一 `pageName` 仅保留首次出现的条目
2. WHEN 同一车型存在多个涂装版本时，THE Scraper SHALL 选择第一个拥有有效（非 Placeholder_Image）图片的版本
3. THE Scraper SHALL 在 releases.json 的每个年度分组中确保不存在重复的车型名称

### 需求 5：前端数据路径统一

**用户故事：** 作为开发者，我希望本地开发和线上部署使用一致的数据加载路径，以便本地调试时能正确加载数据文件。

#### 验收标准

1. THE Frontend SHALL 从相对路径 `data/` 加载所有 JSON 数据文件
2. THE CI_Pipeline 的 build 步骤 SHALL 将 Data_Directory 中的 JSON 文件复制到 `_site/data/` 目录
3. WHEN 开发者运行 Dev_Server 时，THE Dev_Server SHALL 能够正确提供 `data/` 路径下的 JSON 文件
4. THE 项目 SHALL 提供一个构建脚本（`npm run build`），将 `site/` 和 `_data/` 组装到 `_site/` 目录，使本地构建产物与 CI 构建产物结构一致
5. WHEN 开发者运行 `npm run dev` 时，THE Dev_Server SHALL 从构建产物目录（`_site/`）提供服务，确保数据路径与线上一致

### 需求 6：GitHub Actions 工作流修复

**用户故事：** 作为项目维护者，我希望 GitHub Actions 定时任务能可靠运行，抓取最新数据并正确部署，不会因为并发冲突或数据过期而失败。

#### 验收标准

1. THE CI_Pipeline 的 deploy job SHALL 在 checkout 时使用 `ref: main` 并执行 `git pull` 以确保获取 scrape job 提交的最新数据
2. THE CI_Pipeline SHALL 将 `deploy` 和 `deploy-on-push` 合并为单一的 deploy job，通过条件判断处理不同触发场景，避免并发部署冲突
3. THE CI_Pipeline 的 scrape job SHALL 使用 `npm install` 替代 `npm ci`，以容忍 `package-lock.json` 与 `package.json` 之间的微小不一致
4. IF scrape job 执行失败，THEN THE CI_Pipeline SHALL 保留 Data_Directory 中的现有数据文件不被覆盖
5. THE CI_Pipeline SHALL 在 scrape job 失败时通过 workflow 的失败状态通知维护者（利用 GitHub 默认的 Actions 失败通知机制）

### 需求 7：抓取数据安全写入

**用户故事：** 作为项目维护者，我希望抓取失败时不会用空数据覆盖已有的有效数据，以保证网站始终展示最近一次成功抓取的内容。

#### 验收标准

1. WHEN Scraper 完成某类数据的抓取且结果为空数组时，THE Scraper SHALL 跳过该文件的写入操作并输出警告日志
2. WHEN Scraper 完成某类数据的抓取且结果数量少于已有文件中数据量的 50% 时，THE Scraper SHALL 输出警告日志提示数据量异常下降，但仍写入新数据
3. THE Scraper SHALL 在写入每个 JSON 文件前先读取已有文件的条目数量，用于上述比较
4. IF Scraper 在抓取过程中遇到致命错误（如网络完全不可用），THEN THE Scraper SHALL 以非零退出码终止，不写入任何文件

### 需求 8：抓取效率优化

**用户故事：** 作为项目维护者，我希望抓取脚本能在合理时间内完成，减少不必要的重复 API 请求，以降低对 Wiki 服务器的压力并加快 CI 执行速度。

#### 验收标准

1. THE Scraper SHALL 合并 `scrapeNewReleases()` 和 `scrapeReleases()` 中对 `scrapeYearList()` 的重复调用，对同一年度列表页仅解析一次
2. THE Scraper SHALL 支持对 Wiki_API 请求进行有限并发（最多 3 个并发请求），同时保持每个请求之间至少 500ms 的间隔以遵守 API 速率限制
3. THE Scraper SHALL 缓存同一次运行中已获取的 `wikiImageInfo()` 结果，避免对同一图片文件重复请求
4. WHEN Scraper 完成运行时，THE Scraper SHALL 在日志中输出总运行时间和总 API 请求次数

### 需求 9：系列数据动态获取

**用户故事：** 作为风火轮收藏者，我希望系列图鉴中的数据是从 Wiki 动态获取的真实信息，每个系列都链接到正确的 Wiki 页面，而不是硬编码的静态数据。

#### 验收标准

1. THE Scraper SHALL 从 Wiki_API 动态获取系列信息，包括系列名称、描述和对应的 Wiki 页面 URL
2. THE Scraper SHALL 为每个系列生成正确的 Wiki 页面链接（如 `https://hotwheels.fandom.com/wiki/Car_Culture`），而非统一指向首页
3. THE Scraper SHALL 尝试为每个系列获取一张代表性图片
4. WHEN Wiki 中无法获取到足够的系列数据时，THE Scraper SHALL 使用预定义的系列列表作为兜底数据，但仍为每个系列生成正确的 Wiki 链接
5. THE Scraper SHALL 为每个系列提供中文描述，优先使用从 Wiki 提取并翻译的内容，兜底使用预定义的中文描述

### 需求 10：新闻内容质量提升

**用户故事：** 作为风火轮收藏者，我希望新闻板块展示的是有价值的风火轮资讯（如新品发布、系列更新），而不是无意义的 Wiki 编辑记录，以便我能获取真正有用的信息。

#### 验收标准

1. THE Scraper SHALL 过滤掉 `recentchanges` 中 `comment` 为空或仅包含机器人编辑标记的条目
2. THE Scraper SHALL 过滤掉标题仅为年份列表页（如 `List of 20XX Hot Wheels`）的条目，这类页面作为数据源而非新闻
3. WHEN 从 `recentchanges` 获取新闻时，THE Scraper SHALL 优先选择标题包含具体车型名称或系列名称的条目
4. THE Scraper SHALL 为每条新闻生成有意义的摘要：优先使用页面的首段描述文本，而非 Wiki 编辑注释
5. WHEN 新闻条目的摘要仍为 `Wiki page "X" was recently updated` 格式时，THE Scraper SHALL 尝试从该页面提取首段文本作为替代摘要

### 需求 11：新模具展示功能

**用户故事：** 作为风火轮收藏者，我希望网站有一个专门的区域展示当年的新模具车型，以便我能快速了解今年有哪些全新设计的车型发布。

#### 验收标准

1. THE Scraper SHALL 从 Wiki 的年度新模具列表页（如 `List of 20XX Hot Wheels new castings`）抓取新模具数据
2. THE Scraper SHALL 为每个新模具条目提取车型名称、图片、设计师（如有）和首发系列信息
3. THE Scraper SHALL 将新模具数据输出为 `_data/new-castings.json` 文件
4. THE Frontend SHALL 在导航栏中添加"新模具"入口，展示当年的新模具车型列表
5. THE Frontend SHALL 以卡片网格形式展示新模具，每张卡片包含车型图片、名称和首发系列

### 需求 12：搜索功能

**用户故事：** 作为风火轮收藏者，我希望能在网站上搜索特定的车型名称，以便快速找到我感兴趣的车型信息。

#### 验收标准

1. THE Frontend SHALL 在导航栏中提供一个搜索输入框
2. WHEN 用户在搜索框中输入文字时，THE Frontend SHALL 在所有已加载的数据（featured、releases、new-castings、gallery）中进行客户端模糊匹配搜索
3. THE Frontend SHALL 在搜索输入后 300ms 的防抖延迟后显示搜索结果
4. THE Frontend SHALL 以下拉列表形式展示最多 10 条搜索结果，每条结果包含车型名称、缩略图（如有）和所属分类
5. WHEN 用户点击搜索结果时，THE Frontend SHALL 滚动到对应的页面区域或打开对应的 Wiki 链接
6. WHEN 搜索无匹配结果时，THE Frontend SHALL 显示"未找到相关车型"的提示信息

### 需求 13：`extractDescription()` 嵌套模板解析修复

**用户故事：** 作为开发者，我希望描述提取函数能正确处理 Wiki 中的嵌套模板，不会因为正则表达式匹配失败而在描述中残留模板标记。

#### 验收标准

1. THE Scraper 的文本清洗逻辑 SHALL 使用递归或迭代方式处理嵌套的 `{{...}}` 模板，从最内层开始逐层移除
2. THE Scraper SHALL 正确处理包含管道符 `|` 的模板参数（如 `{{template|param1|param2}}`）
3. THE Scraper SHALL 正确处理模板中包含的 Wiki 链接（如 `{{template|[[Link|Text]]}}`）
4. WHEN 模板嵌套深度超过 10 层时，THE Scraper SHALL 将整个未解析的模板块移除，而非陷入无限循环

