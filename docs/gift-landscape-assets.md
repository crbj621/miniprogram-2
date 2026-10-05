# 祝福网站风景图片资产

## 当前文件与使用关系

项目图片目录：`server/public/gifts/backgrounds/`。四种免费静态插画各提供竖幅和横幅；网页按视口方向选择WebP，小程序使用对应原生JPEG。真实动态背景使用独立循环视频，静态图没有旧天空、火焰或海面动画。

| 场景 | 目录 ID | 竖幅文件 | 横幅文件 |
| --- | --- | --- | --- |
| 草原星夜 | meteors | grassland-night.webp | grassland-night-wide.webp |
| 森林月夜 | campfire | forest-night.webp | forest-night-wide.webp |
| 晴空花野 | clouds3d | clouds-day.webp | clouds-day-wide.webp |
| 极光海岸 | halo3d | aurora-coast.webp | aurora-coast-wide.webp |

配置入口为 `server/data/gifts/catalog.json` 中的 `poster`、`widePoster`、`nativePoster`；视频项另有`video.portrait/wide`。网页资源由 `server/src/gift-web.js`、`server/public/gifts/background.js` 和 `gift.css` 使用。小程序编辑器的 `quote()`、展示页的 `load()` 使用JPEG竖幅地址 `/campus-api/gift-assets/backgrounds/<文件名>`，通过现有 `www.crbuj.icu` 读取。图片、视频存放服务器共享目录，不进入小程序主包，也不为每个用户复制。

| 文件 | 像素尺寸 | WebP 字节 | 原 PNG 字节 |
| --- | ---: | ---: | ---: |
| grassland-night.webp | 1086×1448 | 373,680 | 2,773,334 |
| grassland-night-wide.webp | 1672×941 | 436,864 | 2,881,108 |
| forest-night.webp | 1024×1536 | 421,308 | 2,944,528 |
| forest-night-wide.webp | 1672×941 | 432,030 | 2,849,387 |
| aurora-coast.webp | 1024×1536 | 380,026 | 2,899,540 |
| aurora-coast-wide.webp | 1672×941 | 436,232 | 2,899,430 |
| clouds-day.webp | 1024×1536 | 355,596 | 2,706,954 |
| clouds-day-wide.webp | 1672×941 | 385,870 | 2,611,113 |

8 个 WebP 共 3,221,606 字节。横幅生成尺寸为 1672×941，接近 16:9，存在不足 1 像素的比例舍入差；按生成尺寸交付。

## 原图、转换与生成模式

原 PNG、资产校验清单及提示词位于：

```text
C:/Users/Administrator/Downloads/campus-landscape-art-20261004/
├── grassland-night.png / grassland-night-wide.png
├── forest-night.png / forest-night-wide.png
├── aurora-coast.png / aurora-coast-wide.png
├── clouds-day.png / clouds-day-wide.png
├── assets-manifest.json
└── generation-prompts.json
```

本次生成的原 PNG 已在上述 Downloads 目录保留并核对 SHA256；未引用的 `new-*.png` 工作副本移出运行素材目录。维护时以 WebP 为运行素材，外部 PNG 用于原图恢复和后续修图。原小程序图片未改动。

生成模式：imagegen skill 的默认内置 `image_gen` 工具，`transparent_background=false`。横幅先查看对应竖幅，再将本地 PNG 作为场景及画风参考，重新拓展构图。Pillow 12.3 将原 PNG 转成 RGB WebP，`quality=88`、`method=6`；只转换格式，没有裁剪、缩放或重画。8 文件重新解码且尺寸与原 PNG 一致，SHA256 见 `assets-manifest.json`。

## 历史动效地面锚点

本节记录已移出的旧叠加动效设计，仅用于说明原图构图；当前四图是静态插画，background.js不再计算这些锚点。维护时不能恢复为动态背景。

坐标原点是图像左上角，x、y 分别按图像自身宽、高归一化。下面是暖光地面位置，火焰底部应接触这个点。

| 文件 | x | y | 对应像素 | 抽验 RGB |
| --- | ---: | ---: | --- | --- |
| grassland-night.webp | 42% | 82% | (456, 1187) | (246, 183, 122) |
| grassland-night-wide.webp | 42% | 85% | (702, 800) | (248, 193, 112) |
| forest-night.webp | 20% | 84% | (205, 1290) | (255, 180, 71) |
| forest-night-wide.webp | 20% | 85% | (334, 800) | (223, 163, 56) |

旧设计使用`object-fit:cover`将原图锚点映射到画面：s=max(W/Iw,H/Ih)，ox=(W−Iw×s)×px、oy=(H−Ih×s)×py，屏幕地面点为(ox+x×Iw×s, oy+y×Ih×s)。当前版本移除了该计算与互动叠加，静态草原／森林图本身不含动态火焰；篝火动景来自真实MP4。

## 当前资产的生成规格

下列 5 段是 `generation-prompts.json` 保存的完整提示词，内容保持原文；参考路径均对应本机源图。

### clouds-day.webp

参考图：无，新生成竖幅。

```text
Use case: stylized-concept. Asset type: complete portrait background art for a responsive blessing website, approximately 2:3 portrait. Primary request: a bright, delightful daytime anime landscape matte-painting: an expansive green meadow on the edge of a mountain valley, layers of graceful blue-green distant mountains, and a soft sea of clouds resting in the valley far below. Beautiful clear sky occupies the upper 60 percent of the picture, with fine luminous white cumulus clouds and delicate high cloud wisps. Rich close foreground grass and small natural white, pink and blue wildflowers frame the lower 30 percent, with an open grassy patch toward the lower center. Sunlight is airy and transparent, clear spring-day colors, gentle warmth, convincing near/middle/far depth, intricate hand-painted details, polished anime film scenery quality. Keep the central sky calm and spacious for optional website text, but draw NO text or user interface. No people, no characters, no buildings, no geometrical abstraction, no neon technology graphics, no logos, no watermark. Fully opaque background.
```

### grassland-night-wide.webp

参考图：`C:/Users/Administrator/Desktop/miniprogram-2/server/public/gifts/backgrounds/new-grassland-night.png`。

```text
Use case: stylized-concept. Input image: use this portrait as the landscape style and scene reference. Create a NEW wide horizontal 16:9 composition, approximately 1920x1080, by thoughtfully repainting and expanding the scenery left and right; DO NOT crop or stretch the portrait, DO NOT keep a portrait canvas. Preserve the fine anime matte-painting style and the reference's moonlit blue meadow, starry sky, layered mountains and distant bay. Composition: wide night sky with delicate stars, a subtle Milky Way and wispy clouds occupies the upper 60 percent; distant blue hills and water form a thin middle distance; richly textured close meadow grass, natural wildflowers and earth occupy the bottom 30 percent. In the foreground, place a small clearly open warm amber-lit earth clearing centered exactly near x=42 percent of the full canvas width, y=85 percent of the full canvas height, measured from the upper-left. This clearing must be on solid foreground ground and ready for a later animated campfire overlay. Draw a subtle warm light pool only; NO flames, NO campfire, NO firewood, NO logs, NO embers. Keep the center of the sky calm enough for website text. Detailed varied vegetation, convincing atmospheric near/middle/far depth, bright readable landscape despite night, rich blue/teal and amber palette. No people, no characters, no buildings near the foreground, no lettering, no UI, no text, no watermark. Fully opaque background. The final canvas MUST be wide landscape 16:9.
```

### forest-night-wide.webp

参考图：`C:/Users/Administrator/Desktop/miniprogram-2/server/public/gifts/backgrounds/new-forest-night.png`。

```text
Use case: stylized-concept. Input image: use this portrait moonlit forest painting as a scene and art-style reference. Generate a NEW landscape 16:9 wide canvas, approximately 1920x1080. Repaint and expand the scene thoughtfully left and right; DO NOT crop the portrait, DO NOT stretch it, and DO NOT retain the portrait aspect ratio. Preserve the richly detailed anime matte-painting style, the cool teal layered mountains and luminous moonlit forest. Composition: an expansive blue night sky with delicate stars and light clouds fills the upper 60 percent. Tall detailed woodland trees frame the far left and right edges without obscuring the center; distant mountain ridges and blue forested valleys occupy a narrow mid-distance. The entire lower 30 percent is CLOSE foreground grassy woodland clearing, detailed grasses, a few wildflowers and earth, clearly distinct from the distant scenery. Place an open warm amber-lit earthy clearing on solid foreground ground centered precisely near x=20 percent of the full image width, y=85 percent of the full image height (upper-left origin), as the reserved anchor for a later animated fire. Draw the subtle warm light pool and illuminated grass only: no flames, no fire, no campfire, no firewood, no logs, no embers. Soft vivid moonlight, convincing near/middle/far atmospheric depth, readable rich blue/green surroundings, gentle amber highlights. Keep the middle sky spacious and quiet for website copy. No people, no characters, no buildings, no text, no UI, no lettering, no watermark. Fully opaque background. Deliver a horizontal wide 16:9 scene.
```

### aurora-coast-wide.webp

参考图：`C:/Users/Administrator/Desktop/miniprogram-2/server/public/gifts/backgrounds/new-aurora-coast.png`。

```text
Use case: stylized-concept. Input image: use this portrait aurora coast painting as the scene and art-style reference. Create a NEW wide landscape 16:9 image, approximately 1920x1080. Thoughtfully repaint and expand the bay and scenery to the left and right, NOT a cropped or stretched portrait, NOT a portrait canvas. Preserve the richly detailed fine anime matte-painting style, the luminous cool moonlit ocean and the elegant small white lighthouse in the RIGHT middle-distance on a rocky headland. A wide soft deep-blue sky with delicate stars, luminous wispy clouds and just a few flowing pale lavender/turquoise aurora ribbons occupies the upper 60 percent, with central open breathing space for website text. The bay is rimmed by layered distant blue-green mountains and a subtle coast; rich blue/teal moonlit sea reflections form the middle area. The entire lower 30 percent contains close coastal land: a natural grassy sandy shore and rocky beach, detailed wind-swept grass, small natural flowers and clear ground, with convincing near/middle/far depth. The lighthouse must be small and distant rather than a foreground tower. Airy moonlight makes the landscape visible and nuanced, quietly magical, bright rather than gloomy. Aurora is subtle because software will animate extra ribbons later. No people, no characters, no text, no UI, no geometric abstraction, no neon laser graphics, no lettering, no watermark. Fully opaque background. Final image is horizontal wide 16:9.
```

### clouds-day-wide.webp

参考图：`C:/Users/Administrator/Downloads/campus-landscape-art-20261004/clouds-day.png`。

```text
Use case: stylized-concept. Input image: use this portrait bright daytime meadow and mountain sea-of-clouds painting as the scene and art-style reference. Create a NEW horizontal 16:9 wide image, approximately 1920x1080. Repaint and thoughtfully extend the landscape left and right; NOT a cropped or stretched portrait and NOT a portrait canvas. Preserve the fine anime matte-painting style, fresh spring grass, delicate natural wildflowers, airy blue-green layered mountain valley and soft sea of white clouds below the distant ridges. Composition: beautiful clear blue sky with luminous white cumulus clouds and wispy high clouds occupies the upper 60 percent, with plenty of calm open blue sky at center for optional website copy. Distant mountain ridges and cloud-filled valleys form a narrow middle distance. The entire lower 30 percent is CLOSE richly detailed grassy meadow ground, framed by small white, pink and blue wildflowers and a few natural rocks; leave open grassy ground toward the lower center. Bright transparent sunlight, vivid but gentle blue/green palette and warm soft highlights, convincing close/middle/far scenic depth, finely painted anime film scenery rather than flat geometric art. No people, no characters, no buildings, no text, no UI, no lettering, no watermarks, no technology abstraction. Fully opaque background. Final canvas is landscape wide 16:9.
```

### 森林竖幅生成规格摘要

以下是最初 `forest-night.webp` 的生成提示词摘要，不声称是逐字原文：竖幅约 2:3 的细腻动漫 matte-painting；冷青色层叠远山、月光树林与林间草地；天空约上方 60%，星点和薄云，中央留文案呼吸空间，画面有清晰近中远层次。下方偏左放温暖朦胧光池，给后续动态火焰留位置；不画火焰、篝火、木柴或余烬；没有人物、建筑、文字、UI、水印；背景不透明。

### 海岸竖幅生成规格摘要

以下是最初 `aurora-coast.webp` 的生成提示词摘要，不声称是逐字原文：竖幅约 2:3 的细腻动漫风景画；远处海湾与蓝青山峦，右侧中下部为小白灯塔，深蓝碧青海面映出月光，近处海滩草和岩石；天空约上方 60%，淡紫和青色极光疏朗，中央留文字空间。空气通透、夜景明亮，保持近中远景深；没有人物、文字、UI、水印，不使用扁平几何或抽象科技图案；背景不透明。

### 草原竖幅生成规格摘要

以下为初始规格摘要，不声称是逐字提示词：竖幅3:4的细腻动漫风景底图，蓝紫色星夜与银河、左上方月亮、层叠远山与湖泊山谷。天空约60%，地平线约65%；近处为草地与自然花朵，在偏左下约42%×85%留暖琥珀色空地，供动态篝火叠加。不绘制火焰、木柴、流星；没有人物、文字、UI、帐篷、水印，不使用照片、扁平多边形或霓虹抽象图案。横幅重新构图的完整提示词如上。

## 验证范围

本机已检查8个WebP、4个原生JPEG和4个MP4的尺寸、解码及容量。4种静态风景×3个视口已检查真实像素与构图，不加载背景动画引擎；2视频检查实际播放时间、画面变化、循环、视口选源和生命周期。小程序编辑器、展示页使用真实WXML/WXSS，原生图片解码／两列对齐和公网素材记录见docs/ui-preview/gifts；发布完成状态以operations.md为准。原生封面不能当作完整网页视频已播放的证据。


## 2026-10-04 用户确认后的分类与视频

用户要求风景本身运动，图片加少量粒子不算动态。最终草原星夜、森林月夜、晴空花野、极光海岸归入免费静态背景；旧ID保留，移除scene动画参数。不要把前文生成图片过程或旧浏览器动效测试当成当前分类。

真正的动态背景为video-fire「夜晚篝火」与video-stars「星河夜幕」，各6金币，首次2小时体验沿原规则免费。原视频来源、作者和许可见server/public/gifts/videos/SOURCES.md。统一共享4个MP4共5,655,460字节；每份网站保存背景ID，未创建独立视频副本或独立Node进程。

微信开发者工具实测WebP的getImageInfo返回invalid，而同接口PNG成功；因此原生小程序明确使用catalog.nativePoster：4幅风景以原PNG无裁切转为JPEG，原始尺寸不变，共2,570,761字节。浏览器继续使用竖横WebP，两个视频用竖横JPEG封面。视频素材与原MP4在Downloads/campus-gift-videos-20261004；处理参数与SHA记录processed-assets-manifest.json。原生4图的参数与SHA记录Downloads/campus-landscape-art-20261004/native-assets-manifest.json。

网页使用单个原生video，根据视口选横版或竖版，静音循环、内联播放；图片封面不代表正在播放。后台、默认减少动态偏好、网站到期时释放媒体源，恢复时重新选源；自动播放受限或网络失败可点击独立播放／重试按钮，主动播放可以覆盖减少动态偏好，手动暂停保持到再次主动播放。素材体积固定，访问越多产生的流量和手机耗电仍会增加。

小程序编辑器、展示页使用同一utils/video.ts，在340rpx顶部卡片播放共享横版MP4；catalog.video与公开/api/gifts/:id的backgroundVideo提供地址，原生视频失败时保留JPEG封面。每次换源／重试采用新的节点身份，迟到事件不能改写当前状态；异步挂载完成后校验最新意图再play/pause，缓冲后时间继续前进恢复正在播放状态。原生实播和首页只读health记录见ui-preview/status-video/native-verification.json；未为每个网站复制视频。
