/* 手写的 Markdown 解析器,零依赖。
 * 用法: markdown.toHtml('# 标题')  */
(function (global) {
  'use strict';

  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /* 行内语法:代码、图片、链接、粗体、斜体、删除线 */
  function inline(text) {
    var s = escapeHtml(text);
    var codes = [];
    // 先抽出行内代码,防止里面的语法被二次处理
    s = s.replace(/`([^`]+)`/g, function (_, code) {
      codes.push('<code>' + code + '</code>');
      return '\u0000' + (codes.length - 1) + '\u0000';
    });
    s = s
      .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, function (_, alt, src, title) {
        var t = title ? ' title="' + title + '"' : '';
        return '<img src="' + src + '" alt="' + alt + '"' + t + '>';
      })
      .replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, function (_, label, href, title) {
        var t = title ? ' title="' + title + '"' : '';
        return '<a href="' + href + '"' + t + ' target="_blank" rel="noopener">' + label + '</a>';
      })
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>')
      .replace(/(^|[^_])_([^_\n]+)_(?!_)/g, '$1<em>$2</em>')
      .replace(/~~([^~]+)~~/g, '<del>$1</del>');
    return s.replace(/\u0000(\d+)\u0000/g, function (_, i) {
      return codes[+i];
    });
  }

  function parse(src) {
    var lines = String(src).replace(/\r\n?/g, '\n').split('\n');
    var out = [];
    var i = 0;

    while (i < lines.length) {
      var line = lines[i];

      // 围栏代码块 ```
      var fence = line.match(/^```(\w*)\s*$/);
      if (fence) {
        var codeLines = [];
        i++;
        while (i < lines.length && !/^```\s*$/.test(lines[i])) {
          codeLines.push(lines[i]);
          i++;
        }
        i++; // 跳过结束 ```
        var cls = fence[1] ? ' class="language-' + fence[1] + '"' : '';
        out.push('<pre><code' + cls + '>' + escapeHtml(codeLines.join('\n')) + '</code></pre>');
        continue;
      }

      // 标题 # ~ ######
      var h = line.match(/^(#{1,6})\s+(.*)$/);
      if (h) {
        out.push('<h' + h[1].length + '>' + inline(h[2]) + '</h' + h[1].length + '>');
        i++;
        continue;
      }

      // 水平线
      if (/^\s*(\*\s*){3,}$|^\s*(-\s*){3,}$|^\s*(_\s*){3,}$/.test(line)) {
        out.push('<hr>');
        i++;
        continue;
      }

      // 引用块
      if (/^>\s?/.test(line)) {
        var quoteLines = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) {
          quoteLines.push(lines[i].replace(/^>\s?/, ''));
          i++;
        }
        out.push('<blockquote>' + parse(quoteLines.join('\n')) + '</blockquote>');
        continue;
      }

      // 无序列表(支持嵌套,按缩进两层)
      if (/^\s*[-*+]\s+/.test(line)) {
        out.push(buildList(lines, i, false).html);
        i = buildList(lines, i, false).next;
        continue;
      }

      // 有序列表
      if (/^\s*\d+\.\s+/.test(line)) {
        out.push(buildList(lines, i, true).html);
        i = buildList(lines, i, true).next;
        continue;
      }

      // 表格 | a | b |,第二行必须是 |---|---| 形式
      if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length &&
          /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && lines[i + 1].indexOf('-') !== -1) {
        var splitRow = function (row) {
          return row.trim().replace(/^\||\|$/g, '').split('|').map(function (c) { return c.trim(); });
        };
        var headers = splitRow(line);
        i += 2;
        var rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
          rows.push(splitRow(lines[i]));
          i++;
        }
        var table = '<table><thead><tr>';
        headers.forEach(function (c) { table += '<th>' + inline(c) + '</th>'; });
        table += '</tr></thead><tbody>';
        rows.forEach(function (r) {
          table += '<tr>';
          headers.forEach(function (_, cIdx) { table += '<td>' + inline(r[cIdx] || '') + '</td>'; });
          table += '</tr>';
        });
        table += '</tbody></table>';
        out.push(table);
        continue;
      }

      // 空行
      if (/^\s*$/.test(line)) {
        i++;
        continue;
      }

      // 普通段落(连续非空行合并)
      var paraLines = [line];
      i++;
      while (i < lines.length && !/^\s*$/.test(lines[i]) &&
             !/^(#{1,6})\s/.test(lines[i]) && !/^```/.test(lines[i]) &&
             !/^>\s?/.test(lines[i]) && !/^\s*[-*+]\s+/.test(lines[i]) &&
             !/^\s*\d+\.\s+/.test(lines[i]) && !/^\s*\|.*\|\s*$/.test(lines[i])) {
        paraLines.push(lines[i]);
        i++;
      }
      out.push('<p>' + paraLines.map(inline).join('<br>') + '</p>');
    }

    return out.join('\n');
  }

  /* 从 lines[start] 开始收集一个列表(含嵌套子列表),返回 {html, next} */
  function buildList(lines, start, ordered) {
    var itemRe = ordered ? /^\s*\d+\.\s+/ : /^\s*[-*+]\s+/;
    var items = [];
    var i = start;

    while (i < lines.length) {
      var line = lines[i];
      if (itemRe.test(line)) {
        items.push({ content: [line.replace(itemRe, '')], children: [] });
        i++;
      } else if (/^\s{2,}[-*+]\s+/.test(line) && items.length > 0) {
        items[items.length - 1].children.push(line.replace(/^\s*[-*+]\s+/, ''));
        i++;
      } else if (!/^\s*$/.test(line) && items.length > 0) {
        // 列表项的延续行
        items[items.length - 1].content.push(line.trim());
        i++;
      } else {
        break;
      }
    }

    var tag = ordered ? 'ol' : 'ul';
    var html = '<' + tag + '>';
    items.forEach(function (item) {
      html += '<li>' + inline(item.content.join(' '));
      if (item.children.length > 0) {
        html += '<ul>';
        item.children.forEach(function (c) { html += '<li>' + inline(c) + '</li>'; });
        html += '</ul>';
      }
      html += '</li>';
    });
    html += '</' + tag + '>';
    return { html: html, next: i };
  }

  /* 生成纯文本摘要 */
  function excerpt(src, maxLen) {
    var text = String(src)
      .replace(/```[\s\S]*?```/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[#>*`~_\-|]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    maxLen = maxLen || 120;
    return text.length > maxLen ? text.slice(0, maxLen) + '…' : text;
  }

  global.markdown = { toHtml: parse, excerpt: excerpt };
})(window);
