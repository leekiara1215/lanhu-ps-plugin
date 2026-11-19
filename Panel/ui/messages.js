"use strict";

function displayText(value) {
    return String(value).replace(/[A-Za-z0-9._@:/-]{24,}/g, token => token.match(/.{1,20}/g).join("\n"));
}
function errorText(error, details) {
    const original = String(error && error.message || error);
    details.textContent = displayText((error && error.code ? "错误码：" + error.code + "\n" : "") + original);
    if (/^[\u3400-\u9fff]/.test(original)) return original;
    const translations = [
        [/Open a PSD and select exactly one pixel layer/i, "请打开 PSD，并只选择一个普通像素图层。"],
        [/Only ordinary pixel layers|Masks, styles, advanced blending/i, "仅支持普通像素层；请在独立副本中明确栅格化或合并样式、蒙版、智能对象等内容。"],
        [/8-bit RGB document|already using sRGB/i, "仅支持已使用 sRGB IEC61966-2.1 的八位 RGB 文档；请先在独立副本中转换。"],
        [/visible layers and parents/i, "请确保图层及父层可见、不透明度与填充均为百分之百、使用正常混合且无剪贴关系。"],
        [/descriptor unavailable/i, "无法读取图层外观信息，请重新选择受支持的普通像素层后重试。"],
        [/readback differs|readback mismatch/i, "写入后回读不一致，操作未完成；请保留原稿并重新检查后重试。"],
        [/bounds differ from the recorded target/i, "图层内容范围与已登记目标不一致，请通过面板重新应用目标尺寸。"],
        [/Immutable assetRef conflict/i, "同一资源版本的内容发生冲突；请发布新版本，不要覆盖或合并旧资源。"],
        [/snapshot is missing|legacy resource needs a source snapshot|requires its original source snapshot/i, "缺少原始源快照，请从原始源图层重新定义或导入有效备份，不要从拉伸效果图反推。"],
        [/positive integer dimensions|pixel limit/i, "宽高必须为正整数，源图或预览总像素不得超过 4,194,304。"],
        [/padding must be nonnegative|bounds must be nonempty integer/i, "源图边界须为非空整数像素，透明留白须为非负整数。"],
        [/Unknown required capability|Unsupported.*version/i, "元数据版本或必需能力不受支持；请使用兼容面板或恢复有效备份，不要覆盖现有数据。"],
        [/Duplicate or missing nodeId|Document and artboard identities/i, "文档或图层身份缺失或重复，请在高级操作中检查并显式修复身份。"],
        [/PNG|snapshot.*checksum|snapshot.*block|snapshot.*filter/i, "源图快照无效或不兼容，请保留原文件并导入有效备份，或从原始源图层重新定义。"],
        [/Target canvas|Target content bounds/i, "实例目标画布记录无效，请检查完整尺寸和内容范围并重新应用目标尺寸。"]
    ];
    const found = translations.find(([pattern]) => pattern.test(original));
    const suffixAt = original.search(/[\u3400-\u9fff]/);
    const suffix = suffixAt > 0 ? "\n" + original.slice(suffixAt) : "";
    return (found ? found[1] : "操作未完成，请在高级操作中查看原始诊断，检查文档和图层后重试。") + suffix;
}

module.exports = { displayText, errorText };
