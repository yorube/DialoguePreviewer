// yarn-converter.js
// 純前端版本的 Yarn 翻譯流程（從 v2 C# YarnDialogueSOFactory + YarnLineParser
// 移植）。目前只用到 buildSO — translation-ui.js 的 buildSyntheticSource
// 在沒有譯者上傳檔可參考時，用它從 en-US AST 重建 LocKit 風格 CSV。
//
// 全域 export：window.YarnConverter.buildSO
//
// 注意：character 翻譯需要兩張表配合（en-US 名 → key + key+locale → 翻譯名），
// 這兩張表由 Build-Bundle.ps1 抽 `翻譯對照表.xlsx` sheet6 後預先 bundle 進站。

(function (global) {
    'use strict';

    // 行內指令 regex（與 v2 C# 完全對齊）：
    //   "; <<...>>" / ";<<...>>" / "；<<...>>" / @"($var)"
    const COMMAND_RE      = /; <<[^>]+>>|;<<[^>]+>>|；<<[^>]+>>|@"\(\$[^)]+\)"/g;
    const OPTION_PRED_RE  = /\(\$[^)]+\)/;
    const TAB_WIDTH       = 4;

    // ----- Build SO from JSON -----

    function buildSO(jsonNodes, guid, characterContext) {
        if (!Array.isArray(jsonNodes)) {
            throw new Error('jsonNodes must be an array');
        }
        if (!guid || typeof guid !== 'string') {
            throw new Error('guid must be a non-empty string');
        }
        return jsonNodes.map((src, nodeIndex) => {
            const nodeUid = `${guid}-${nodeIndex}`;
            const body = src.body == null ? '' : String(src.body);
            const lines = body.split('\n');
            const textLines = lines.map((rawLine, idx) =>
                parseLine(rawLine, idx + 1, `${nodeUid}-${idx + 1}`, characterContext));
            return {
                uid: nodeUid,
                title: src.title,
                tags: src.tags,
                body,
                position: src.position,
                colorID: src.colorID,
                textLines,
            };
        });
    }

    // ----- Line parser -----

    function parseLine(rawLine, lineNumber, uid, characterContext) {
        const data = {
            uid,
            lineNumber,
            leadingWhitespaceCount: countLeadingWhitespace(rawLine),
            characterName: '',
            dialogue: '',
            commands: null,
            optionCommand: '',
            category: 'Other',
            nameDisplayType: 'None',
        };
        const trimmed = rawLine.replace(/^\s+/, '');

        if (isDialogue(trimmed)) {
            parseDialogue(trimmed, data, characterContext);
        } else if (trimmed.startsWith('//')) {
            parseSimple(trimmed, data, 'Comment');
        } else if (trimmed.startsWith('->')) {
            parseOption(trimmed, data);
        } else if (trimmed.startsWith('<<') && trimmed.endsWith('>>')) {
            parseSimple(trimmed, data, 'Command');
        } else {
            parseSimple(trimmed, data, 'Other');
        }
        return data;
    }

    function isDialogue(t) {
        return t.includes(':')
            && !t.startsWith('->')
            && !t.startsWith('<<')
            && !t.startsWith('//');
    }

    function parseSimple(trimmed, data, category) {
        data.category = category;
        data.dialogue = trimmed;
    }

    function parseDialogue(trimmed, data, ctx) {
        data.category = 'Dialogue';
        const colonIdx = trimmed.indexOf(':');
        const rawName = trimmed.substring(0, colonIdx).trim();
        const body    = trimmed.substring(colonIdx + 1).trim();

        const communicator = rawName.includes('(c)');
        const unknown      = rawName.includes('?');
        const cleanName    = rawName.replace(/^\?+/, '').replace('(c)', '');

        const resolved = resolveCharacterName(cleanName, ctx);
        if (resolved.found) {
            data.characterName = resolved.name;
            // v2 邏輯：unknown 後 OR 蓋掉 communicator（enum 值衝突的歷史包袱）
            let flag = 'None';
            if (communicator) flag = 'Communicator';
            if (unknown)      flag = 'Unknown';
            if (!communicator && !unknown) flag = 'Normal';
            data.nameDisplayType = flag;
        } else {
            data.characterName = rawName; // 保留 marker 不動
        }

        const ext = extractCommands(body);
        data.dialogue = trimDialogueTail(ext.cleanBody);
        if (ext.commands.length > 0) data.commands = ext.commands;
    }

    function parseOption(trimmed, data) {
        data.category = 'Option';
        const fullBody = trimmed.substring(2).trim();
        const ext = extractCommands(fullBody);
        let cleanBody = ext.cleanBody;

        const m = cleanBody.match(OPTION_PRED_RE);
        if (m) {
            data.optionCommand = m[0];
            cleanBody = cleanBody.replace(OPTION_PRED_RE, '');
        }
        data.dialogue = trimDialogueTail(cleanBody);
        if (ext.commands.length > 0) data.commands = ext.commands;
    }

    function extractCommands(body) {
        COMMAND_RE.lastIndex = 0;
        const matches = body.match(COMMAND_RE);
        if (!matches) return { cleanBody: body, commands: [] };
        const commands = matches.map(m => m.replace(/^[;；]/, '').trim());
        const cleanBody = body.replace(COMMAND_RE, '').trim();
        return { cleanBody, commands };
    }

    function trimDialogueTail(body) {
        return body.split(';')[0].trim();
    }

    function countLeadingWhitespace(line) {
        let count = 0;
        for (const c of line) {
            if (c === ' ') count++;
            else if (c === '\t') count += TAB_WIDTH;
            else break;
        }
        return count;
    }

    // 角色名解析：
    // characterContext = { characterKeys: { en-US name → key }, characterTranslations: { key → { locale → name } }, locale: 'ru-RU' }
    function resolveCharacterName(cleanName, ctx) {
        if (!ctx) return { name: cleanName, found: false };
        const key = ctx.characterKeys && ctx.characterKeys[cleanName];
        if (!key) return { name: cleanName, found: false };
        const trans = ctx.characterTranslations && ctx.characterTranslations[key];
        if (!trans) return { name: cleanName, found: false };
        const localized = trans[ctx.locale];
        if (!localized) return { name: cleanName, found: false };
        return { name: localized, found: true };
    }

    global.YarnConverter = { buildSO };
})(typeof window !== 'undefined' ? window : globalThis);
