// yarn-converter.js
// 純前端版本的 Yarn 翻譯流程（從 v2 C# YarnDialogueSOFactory + YarnLineParser +
// YarnLocalizationService 移植，已經以 PoC 驗證對 ru-RU/fr-FR 產出與 Unity v2
// byte-identical）。
//
// 全域 export：window.YarnConverter
//   - buildSO(jsonContent, guid) : 把 yarn json (parsed array) 解析成 SO-equivalent
//   - applyTranslations(so, translationMap, locale) : 用 UID 表覆寫 dialogue
//   - serializeJson(so) : SO → 與 Newtonsoft.Json Formatting.Indented byte-identical 的字串
//   - resolveCharacterName(rawName, characterTranslations, characterKeys, locale)
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

    // ----- Apply translations to SO -----

    // translationMap: Map<UID, translatedText>
    // 只覆寫 Dialogue / Option 的 .dialogue（與 v2 RemapDialogueByUid 一致），
    // commands / optionCommand / leadingWhitespace 不動。
    function applyTranslations(so, translationMap) {
        if (!translationMap || typeof translationMap.get !== 'function') {
            throw new Error('translationMap must be a Map');
        }
        let applied = 0;
        for (const node of so) {
            for (const line of node.textLines) {
                if (line.category !== 'Dialogue' && line.category !== 'Option') continue;
                const t = translationMap.get(line.uid);
                if (t == null || t === '') continue;
                line.dialogue = String(t).replace(/"/g, ''); // 對齊 v2 的 .Replace("\"", "")
                applied++;
            }
        }
        return applied;
    }

    // ----- Serialize SO → JSON string (Newtonsoft.Json Formatting.Indented compatible) -----

    function serializeJson(so) {
        const arr = so.map(node => ({
            title: node.title,
            tags: node.tags,
            body: buildBody(node.textLines),
            position: node.position,
            colorID: node.colorID,
        }));
        // Newtonsoft 預設縮排 2 空白 + Windows 行尾 \r\n
        let json = JSON.stringify(arr, null, 2);
        json = json.replace(/\n/g, '\r\n');
        return json;
    }

    function buildBody(textLines) {
        return textLines.map(buildLine).join('\n');
    }

    function buildLine(line) {
        let prefix = '';
        if (line.leadingWhitespaceCount > 0) {
            prefix = ' '.repeat(line.leadingWhitespaceCount);
        }
        let body = '';
        if (line.category === 'Dialogue') {
            body = buildDialoguePrefix(line) + appendCommands(line.commands);
        } else if (line.category === 'Option') {
            body = '-> ' + line.dialogue + (line.optionCommand || '') + appendCommands(line.commands);
        } else {
            body = line.dialogue;
        }
        return prefix + body;
    }

    function buildDialoguePrefix(line) {
        const name = line.characterName || '';
        let s = '';
        if (line.nameDisplayType === 'Unknown') s += '?';
        s += name;
        if (line.nameDisplayType === 'Communicator') s += '(c)';
        s += ': ' + line.dialogue;
        return s;
    }

    function appendCommands(commands) {
        if (!commands || commands.length === 0) return '';
        return commands.map(c => ' ; ' + c).join('');
    }

    // ----- Public API -----

    global.YarnConverter = {
        buildSO,
        applyTranslations,
        serializeJson,
        resolveCharacterName,
        // 暴露給 UI 看每行屬性（例如 dialogue/option 的 UID）
        parseLine,
    };
})(typeof window !== 'undefined' ? window : globalThis);
