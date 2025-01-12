/**
 * Helps to manage decorations for the TOML files.
 */
import {
  DecorationOptions,
  TextEditor,
  MarkdownString,
  DecorationInstanceRenderOptions,
  Range,
} from "vscode";

import { checkVersion } from "../semver/semverUtils";
import Item from "../core/Item";
import { ReplaceItem } from "../commands/replacers/replace";
import { validRange } from "semver";
import { Language } from "../core/Language";
import { Configs } from "../config";
import DecorationPreferences from "./pref";

/**
 * Create a decoration for the given crate.
 * @param editor
 * @param crate
 * @param version
 * @param versions
 */
export default function decoration(
  editor: TextEditor,
  item: Item,
  versions: string[],
  decorationPreferences: DecorationPreferences,
  lang: Language,
  vuln: Map<string, string[]> | undefined,
  error?: string,
): [DecorationOptions, "COMP" | "INCOMP" | "ERROR"] {
  // Also handle json valued dependencies
  const version = item.value?.replace(",", "");
  const [satisfies, maxSatisfying] = checkVersion(version, versions);

  const formatError = (error: string) => {
    // Markdown does not like newlines in middle of emphasis, or spaces next to emphasis characters.
    const error_parts = error.split('\n');
    const markdown = new MarkdownString("#### Errors ");
    markdown.appendMarkdown("\n");
    // Ignore empty strings
    error_parts.filter(s => s).forEach(part => {
      markdown.appendMarkdown("* ");
      markdown.appendText(part.trim()); // Gets rid of Markdown-breaking spaces, then append text safely escaped.
      markdown.appendMarkdown("\n"); // Put the newlines back
    });
    return markdown;
  };
  let hoverMessage = new MarkdownString();

  const position = decorationPreferences.position;
  const renderOptions: DecorationInstanceRenderOptions = {
    [position]: {
      contentText: "",
    }
  };
  let type = "COMP" as "COMP" | "INCOMP" | "ERROR";


  if (error) {
    hoverMessage = formatError(error);
    type = "ERROR";
  } else {

    appendVulnerabilities(hoverMessage, vuln, version!);

    hoverMessage.appendMarkdown("#### Versions");
    hoverMessage.appendMarkdown(getLinks(lang, item.key));
    hoverMessage.isTrusted = true;
    // Build markdown hover text
    appendVersions(hoverMessage, versions, item, maxSatisfying ?? "", vuln, decorationPreferences, lang);

    if (version == "?") {
      const version = versions[0];
      const info: ReplaceItem = {
        value: version,
        range: item.range,
      };
      editor.edit((edit) => {
        edit.replace(item.range, info.value.substr(1, info.value.length - 2));
      });
      editor.document.save();
    }
    if (!validRange(version)) {
      type = "ERROR";
    } else if (versions[0] !== maxSatisfying) {
      type = satisfies ? "COMP" : "INCOMP";

    }

    const contentText = getContentText(decorationPreferences, type);
    renderOptions[position]!.contentText = contentText.replace("${version}", versions[0]);

    const vulnerabilities = vuln?.get(version!);
    if (vulnerabilities && vulnerabilities.length > 0) {
      const vulnText = decorationPreferences.vulnText.replace("${count}", `${vulnerabilities?.length}`);
      renderOptions[position]!.contentText = renderOptions[position]!.contentText! + "\t" + vulnText;
    }
  }

  const deco: DecorationOptions = {
    range: position == "after" ? item.decoRange : new Range(item.line, 0, item.line, item.endOfLine),
    hoverMessage,
    renderOptions,
  };
  return [deco, type];
}


function getContentText(decorationPreferences: DecorationPreferences, type: string) {
  let contentText = decorationPreferences.compatibleText;
  if (type === "INCOMP") {
    contentText = decorationPreferences.incompatibleText;
  }
  if (type === "ERROR") {
    contentText = decorationPreferences.errorText;
  }
  return contentText;
}
function getLinks(lang: Language, key: string): string {
  const cleanKey = key.replace(/"/g, "");

  switch (lang) {
    case Language.Rust:
      return ` _( [View Crate](https://crates.io/crates/${cleanKey}) | [Check Reviews](https://web.crev.dev/rust-reviews/crate/${cleanKey}) )_`;
    case Language.Golang:
      return ` _( [View Module](https://pkg.go.dev/${cleanKey}) | [Check Docs](https://pkg.go.dev/${cleanKey}#section-documentation) )_`;
    case Language.JS:
      return ` _( [View Package](https://npmjs.com/package/${cleanKey}) )_`;
    case Language.Python:
      return ` _( [View Package](https://pypi.org/project/${cleanKey}) )_`;
    default:
      return '';
  }
}

function getDocsLink(lang: Language, key: string, version: string): string {
  switch (lang) {
    case Language.Rust:
      return `[(docs)](https://docs.rs/crate/${key}/${version})`;
    case Language.Golang:
      return `[(docs)](https://pkg.go.dev/${key}@${version}#section-documentation)`;
    case Language.JS:
      return `[(docs)](https://npmjs.com/package/${key}/v/${version})`;
    case Language.Python:
      return `[(docs)](https://pypi.org/project/${key}/${version})`;
    default:
      return '';
  }
}

function appendVulnerabilities(hoverMessage: MarkdownString, vuln: Map<string, string[]> | undefined, version: string) {
  const v = vuln?.get(version);
  if (v?.length) {
    hoverMessage.appendMarkdown("#### Vulnerabilities (Current)");
    const vulnTexts: string[] = [];
    v?.forEach((v) => {
      const tmp = ` - [${v}](https://osv.dev/vulnerability/${v}) \n`;
      vulnTexts.push(tmp);
    });
    hoverMessage.appendMarkdown("\n" + vulnTexts.join(""));
  }
}


function appendVersions(hoverMessage: MarkdownString, versions: string[], item: Item, maxSatisfying: string, vuln: Map<string, string[]> | undefined, decorationPreferences: DecorationPreferences, lang: Language) {
  for (let i = 0; i < versions.length; i++) {
    const version = versions[i];
    const v = vuln?.get(version);
    const replaceData: ReplaceItem = {
      value: version,
      range: {
        start: { line: item.range.start.line, character: item.range.start.character },
        end: { line: item.range.end.line, character: item.range.end.character },
      }
    };

    const isCurrent = version === maxSatisfying;
    const encoded = encodeURI(JSON.stringify(replaceData));
    const docs = (i === 0 || isCurrent) ? getDocsLink(lang, item.key, version) : "";
    const vulnText = v?.length ? decorationPreferences.vulnText.replace("${count}", `${v?.length}`) : "";
    const command = `${isCurrent ? "**" : ""}[${version}](command:${Configs.REPLACE_VERSIONS}?${encoded})${docs}${isCurrent ? "**" : ""}  ${vulnText}`;
    hoverMessage.appendMarkdown("\n * ");
    hoverMessage.appendMarkdown(command);
  }
}
