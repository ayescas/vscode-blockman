import lexer from "./tagAlgos/tagLexer";
import { Tag, PartialMatch } from "./tagAlgos/interfaces";
import config from "./tagAlgos/tagConfigurations";

import * as babelParser from "@babel/parser";
import babelTraverse from "@babel/traverse";

import { File } from "@babel/types";

import * as vscode from "vscode";
import {
    allWhiteSpace,
    bracketManager,
    glo,
    dropTextLinesMapForEditor,
    IEditorInfo,
    oneCharLineBreaks,
} from "./extension";
import { renderSingleBlock } from "./renderingTools";
import { pyFn } from "./pythonAlgos/python-algo";
import { resolve } from "path";

export interface IPositionEachZero {
    char?: string;
    globalIndexZero: number;
    lineZero: number;
    inLineIndexZero: number;
    type: string; // "s" or "e" or other
}

export const findLineZeroAndInLineIndexZero = ({
    // TODO: editor and doc insert arguments
    globalIndexZero,
    editorInfo,
}: {
    globalIndexZero: number;
    editorInfo: IEditorInfo;
}): {
    lineZero: number;
    inLineIndexZero: number;
} => {
    // const pos = doc.positionAt(globalIndexZero);
    // // console.log("doc.positionAt(1):", doc.positionAt(1));
    // return {
    //     lineZero: pos.line,
    //     inLineIndexZero: pos.character,
    // };

    // old implementation:

    const lastLineZero = editorInfo.textLinesMap.length - 1;
    for (let i = 0; i <= lastLineZero; i += 1) {
        if (
            i === lastLineZero ||
            (globalIndexZero >= editorInfo.textLinesMap[i] &&
                globalIndexZero < editorInfo.textLinesMap[i + 1])
        ) {
            return {
                lineZero: i,
                inLineIndexZero: globalIndexZero - editorInfo.textLinesMap[i],
            };
        }
    }
    return {
        lineZero: -1,
        inLineIndexZero: -1,
    };
};

export const findInnerStartersEndersOfTags = ({
    editorInfo,
    myString,
}: {
    editorInfo: IEditorInfo;
    myString: string;
}) => {
    const tagsList: PartialMatch[] = parseTags(myString, config.emptyElements);

    // console.log("tagsList:", tagsList);

    let legitTagsList: IPositionEachZero[] = [];

    for (let i = 0; i < tagsList.length; i += 1) {
        if (tagsList[i].closing?.start !== undefined && tagsList[i].opening) {
            // console.log("i aris", i, "da is:", tagsList[i].opening?.end);
            const openEnd = tagsList[i].opening!.end! - 1;
            const closeStart = tagsList[i].closing!.start!;

            // console.log("oc:", openEnd, closeStart);

            const lineAndInlineOfOpenEnd = findLineZeroAndInLineIndexZero({
                globalIndexZero: openEnd,
                editorInfo,
            });
            const lineAndInlineOfcloseStart = findLineZeroAndInLineIndexZero({
                globalIndexZero: closeStart,
                editorInfo,
            });

            legitTagsList.push(
                {
                    globalIndexZero: openEnd,
                    lineZero: lineAndInlineOfOpenEnd.lineZero,
                    inLineIndexZero: lineAndInlineOfOpenEnd.inLineIndexZero,
                    type: "s", // "s" or "e" or other);
                },
                {
                    globalIndexZero: closeStart,
                    lineZero: lineAndInlineOfcloseStart.lineZero,
                    inLineIndexZero: lineAndInlineOfcloseStart.inLineIndexZero,
                    type: "e", // "s" or "e" or other);
                },
            );
        }
    }
    // console.log("legitTagsList:", legitTagsList);

    // let starters: IPositionEachZero[] = [];
    // let enders: IPositionEachZero[] = [];

    // const re_start = /(<[^/][^><]*[^/=]>)|(<[ a-zA-Z]*>)/gimu;
    // const re_end = /<[/][^><]*>/gimu;

    // // myString = "foob<asD></asd>arfoobar";
    // let match: any;

    // /*eslint-disable */
    // while ((match = re_start.exec(myString)) != null) {
    //     const first_i = match.index;
    //     const last_i = first_i + match[0].length - 1;
    //     // console.log(last_i);
    //     const lineZeroAndInLineZero = findLineZeroAndInLineIndexZero(last_i);
    //     starters.push({
    //         globalIndexZero: last_i,
    //         lineZero: lineZeroAndInLineZero.lineZero,
    //         inLineIndexZero: lineZeroAndInLineZero.inLineIndexZero,
    //         type: "s",
    //     });
    // }

    // /*eslint-disable */
    // while ((match = re_end.exec(myString)) != null) {
    //     const first_i = match.index;
    //     // console.log(first_i);
    //     const lineZeroAndInLineZero = findLineZeroAndInLineIndexZero(first_i);
    //     enders.push({
    //         globalIndexZero: first_i,
    //         lineZero: lineZeroAndInLineZero.lineZero,
    //         inLineIndexZero: lineZeroAndInLineZero.inLineIndexZero,
    //         type: "e",
    //     });
    // }

    // let finalArr = [...starters, ...enders].sort(
    //     (a, b) => a.globalIndexZero - b.globalIndexZero,
    // );
    // console.log("finalArr:", finalArr);
    // return finalArr;
    return legitTagsList;
};

export const parseTags = (
    text: string,
    emptyElements: string[] = [],
): PartialMatch[] => {
    // Here the tags will be put as they are resolved
    const workingList: PartialMatch[] = [];

    // Looks for last unclosed opening tag, e.g. <div attr=""
    const closeLastOpening = (endPosition: number) => {
        for (let i = workingList.length - 1; i >= 0; i--) {
            const openingTag = workingList[i].opening;
            if (openingTag && !openingTag.end) {
                openingTag.end = endPosition;
                return openingTag;
            }
        }
        return undefined;
    };

    /*
    Looks for the last "name" tag pair without a matching closing tag;
    Closes any unclosed tags in between;
    Closes the matching tag;
  */
    const closeMatchingOpeningTag = (closingTag: Tag, nestingLevel: number) => {
        const unclosedPairs: PartialMatch[] = [];

        for (let i = workingList.length - 1; i >= 0; i--) {
            const openingTag = workingList[i].opening;
            if (
                openingTag &&
                openingTag.end &&
                !workingList[i].closing &&
                workingList[i].attributeNestingLevel === nestingLevel &&
                !unclosedPairs.includes(workingList[i])
            ) {
                if (openingTag.name === closingTag.name) {
                    workingList[i].closing = closingTag;
                    return;
                }
                unclosedPairs.push(workingList[i]);
            }
        }

        // No opening tag was found, so we push a pair with closing tag only
        workingList.push({
            attributeNestingLevel: nestingLevel,
            closing: closingTag,
        });
    };

    // Every block inside of attribute has higher level, to avoid matching with outside
    let attributeNestingLevel = 0;
    let lastOpening: Tag;

    lexer.reset(text);
    let match = lexer.next();
    while (match !== undefined) {
        switch (match.type) {
            case "tagOpening":
                workingList.push({
                    attributeNestingLevel,
                    opening: {
                        name: match.value.slice(1),
                        start: match.offset,
                    },
                });
                attributeNestingLevel += 1;
                break;
            case "closeTag":
                lastOpening = closeLastOpening(match.offset + 1) as Tag;
                attributeNestingLevel -= 1;
                if (emptyElements.includes(lastOpening.name)) {
                    closeMatchingOpeningTag(lastOpening, attributeNestingLevel);
                }
                break;
            case "tagSelfClose":
                lastOpening = closeLastOpening(match.offset + 2) as Tag;
                attributeNestingLevel -= 1;
                // closeMatchingOpeningTag(lastOpening, attributeNestingLevel); // comm007
                break;
            case "tagClosing":
                closeMatchingOpeningTag(
                    {
                        name: match.value.slice(2, -1),
                        start: match.offset,
                        end: match.offset + match.value.length,
                    },
                    attributeNestingLevel,
                );
                break;
        }

        match = lexer.next();
    }

    return workingList;
};

// block start, block end

// let arrayOfLevels__arraysOfBlocks0 = [
//     [
//         { s: 4, e: 105 },
//         { s: 120, e: 130 }
//     ],
//     [
//         { s: 8, e: 50 },
//         { s: 60, e: 100 },
//         { s: 155, e: 160 }
//     ],
//     [
//         { s: 9, e: 40 },
//         { s: 67, e: 90 },
//         { s: 156, e: 157 }
//     ]
// ];

export const generateTextLinesMap = (text: string, editorInfo: IEditorInfo) => {
    dropTextLinesMapForEditor(editorInfo.editorRef);
    for (let i = 0; i < text.length; i += 1) {
        if (i === 0) {
            editorInfo.textLinesMap.push(i);
        }

        if (i > 0 && oneCharLineBreaks.includes(text[i - 1])) {
            editorInfo.textLinesMap.push(i);
        }
    }
};

export const getMacroInfoOfFile = (
    editorInfo: IEditorInfo,
    workString: string,
) => {
    let entireFileLeftMost = 5000;
    let entireFileRightMost = -1;

    let entireFileTopVisLineZero = -1;
    let entireFileBottomVisLineZero = -1;

    let allStartEndIndicators: IPositionEachZero[] = []; // depricated, obsolete
    let allFirstLastNonWhitesInEachLine: IPositionEachZero[] = [];

    let currFirstIndex = -1;
    let currFirstIndexInLine = -1;
    let currFirstFound = false;
    let currLastIndex = -1;
    let currLastIndexInLine = -1;

    let wLength = workString.length;

    let currLineZero = 0;
    let currInLineIndexZero = 0;

    // dropTextLinesMapForEditor(editorInfo.editorRef);
    for (let i = 0; i < wLength; i += 1) {
        // if (i === 0) {
        //     editorInfo.textLinesMap.push(i);
        // }

        if (i > 0 && oneCharLineBreaks.includes(workString[i - 1])) {
            currLineZero += 1;
            currInLineIndexZero = 0;
            // editorInfo.textLinesMap.push(i);
        }

        // collect firstLastNonWhites

        const doPushFirstLast = () => {
            entireFileLeftMost = Math.min(
                entireFileLeftMost,
                currFirstIndexInLine,
            );
            entireFileRightMost = Math.max(
                entireFileRightMost,
                currLastIndexInLine,
            );

            if (entireFileTopVisLineZero < 0) {
                entireFileTopVisLineZero = currLineZero;
            }
            entireFileBottomVisLineZero = currLineZero;

            allFirstLastNonWhitesInEachLine.push({
                globalIndexZero: currFirstIndex,
                lineZero: currLineZero,
                inLineIndexZero: currFirstIndexInLine,
                type: "leftMostInLine",
            });
            allFirstLastNonWhitesInEachLine.push({
                globalIndexZero: currLastIndex,
                lineZero: currLineZero,
                inLineIndexZero: currLastIndexInLine,
                type: "RightMostInLine",
            });
        };

        if (!allWhiteSpace.includes(workString[i])) {
            // if found visible char
            currLastIndex = i;
            currLastIndexInLine = currInLineIndexZero;
            if (!currFirstFound) {
                currFirstIndex = i;
                currFirstIndexInLine = currInLineIndexZero;
                currFirstFound = true;
            }
        } else if (
            currFirstFound &&
            oneCharLineBreaks.includes(workString[i])
        ) {
            currFirstFound = false;
            doPushFirstLast();
        }

        if (i === wLength - 1 && currFirstFound) {
            currFirstFound = false;
            doPushFirstLast();
        }

        currInLineIndexZero += 1;
    }
    return {
        allStartEndIndicators,
        allFirstLastNonWhitesInEachLine,
        entireFileLeftMost,
        entireFileRightMost,
        entireFileTopVisLineZero,
        entireFileBottomVisLineZero,
    };
};

const findEndIndicatorIndexAsPlace = (
    allIndicatorsArr: IPositionEachZero[],
    startIndicatorIndexAsPlace: number,
): number => {
    let numOfInnerStarts = 0; // indicators
    let numOfInnerEnds = 0; // indicators

    for (
        let i = startIndicatorIndexAsPlace + 1;
        i < allIndicatorsArr.length;
        i += 1
    ) {
        if (allIndicatorsArr[i].type === "e") {
            if (numOfInnerStarts === numOfInnerEnds) {
                return i;
            } else {
                numOfInnerEnds += 1;
            }
        } else if (allIndicatorsArr[i].type === "s") {
            numOfInnerStarts += 1;
        }
    }

    return -1;
};

const findSubLevelRangesInRange = (
    allIndicators: IPositionEachZero[],
    rStart: number,
    rEnd: number,
) => {
    let subLevelRanges: { s: number; e: number }[] = [];

    let thisStart = -1;
    let thisEnd = -1;
    for (let p = rStart; p < rEnd; p += 1) {
        if (p <= thisEnd) {
            continue;
        }

        if (allIndicators[p].type === "s") {
            thisStart = p;
            thisEnd = findEndIndicatorIndexAsPlace(allIndicators, p);

            if (thisEnd >= 0 && thisStart >= 0) {
                subLevelRanges.push({ s: thisStart, e: thisEnd });
            }
        }
    }
    return subLevelRanges;
};

export const findArrayOfNLevelsWithArrayOfBlocksInside = (
    allIndicators: IPositionEachZero[],
    maxDepth: number,
) => {
    if (maxDepth <= -1) {
        return [];
    }
    let arrayOfNLevelsWithArrayOfBlocksInside: { s: number; e: number }[][] = [
        findSubLevelRangesInRange(allIndicators, 0, allIndicators.length),
    ];

    for (let i = 1; i <= maxDepth; i += 1) {
        let prevLevelArr: { s: number; e: number }[] =
            arrayOfNLevelsWithArrayOfBlocksInside[i - 1];

        if (prevLevelArr) {
            let newLevelArr: any = [];
            for (let j = 0; j < prevLevelArr.length; j += 1) {
                let nextR = findSubLevelRangesInRange(
                    allIndicators,
                    prevLevelArr[j].s + 1,
                    prevLevelArr[j].e,
                );
                if (nextR && nextR.length > 0) {
                    // newLevelArr.push(nextR);
                    newLevelArr = [...newLevelArr, ...nextR];
                }
            }
            if (newLevelArr.length > 0) {
                arrayOfNLevelsWithArrayOfBlocksInside.push(newLevelArr);
            } else {
                return arrayOfNLevelsWithArrayOfBlocksInside;
            }
        }
    }

    return arrayOfNLevelsWithArrayOfBlocksInside;
};
// // // ===================================================

export interface IBlockRender {
    firstLineHasVisibleChar: boolean;
    lastLineHasVisibleChar: boolean;
    firstVisibleChar: {
        lineZero: number;
        inLineIndexZero: number;
    };
    lastVisibleChar: {
        lineZero: number;
        inLineIndexZero: number;
    };
    optimalLeftOfRange: number;
    optimalRightOfRange: number;

    firstLineZeroOfRender: number;
    lastLineZeroOfRender: number;

    depth: number;
    inDepthBlockIndex: number;
    editorInfo: IEditorInfo;
    lang: string;
    isFocusedBlock: boolean;
    absRangeEndPos?: IPositionEachZero;
}

export interface IOneRange {
    s: IPositionEachZero;
    e: IPositionEachZero;
}

export const findRenderingInfoForBlock = ({
    editorInfo,
    range,
    allFirstLastNonWhites,
    workString,
}: {
    editorInfo: IEditorInfo;
    range: IOneRange;
    allFirstLastNonWhites: IPositionEachZero[];
    workString: string;
}) => {
    let firstVisibleChar: {
        lineZero: number;
        inLineIndexZero: number;
    } = { lineZero: -1, inLineIndexZero: -1 };

    let lastVisibleChar: {
        lineZero: number;
        inLineIndexZero: number;
    } = { lineZero: -1, inLineIndexZero: -1 };

    let firstLineHasVisibleChar = false;
    let lastLineHasVisibleChar = false;

    let foundVisibleFromOpening = false;

    let foundLineBreakFromOpening = false;

    for (
        let i = range.s.globalIndexZero + 1;
        i < range.e.globalIndexZero;
        i += 1
    ) {
        if (
            !foundLineBreakFromOpening &&
            oneCharLineBreaks.includes(workString[i])
        ) {
            foundLineBreakFromOpening = true;
        }

        if (
            !foundVisibleFromOpening &&
            !allWhiteSpace.includes(workString[i])
        ) {
            // found visible
            foundVisibleFromOpening = true;
            firstVisibleChar = findLineZeroAndInLineIndexZero({
                editorInfo,
                globalIndexZero: i,
            });

            if (!foundLineBreakFromOpening) {
                firstLineHasVisibleChar = true;
            }
            break;
        }

        if (!foundVisibleFromOpening && i === range.e.globalIndexZero - 1) {
            return null;
        }
    }

    let foundVisibleFromClosing = false;

    let foundLineBreakFromClosing = false;

    if (foundVisibleFromOpening) {
        for (
            let i = range.e.globalIndexZero - 1;
            i > range.s.globalIndexZero;
            i -= 1
        ) {
            if (
                !foundLineBreakFromClosing &&
                oneCharLineBreaks.includes(workString[i])
            ) {
                foundLineBreakFromClosing = true;
            }

            if (
                !foundVisibleFromClosing &&
                !allWhiteSpace.includes(workString[i])
            ) {
                // found visible
                foundVisibleFromClosing = true;
                lastVisibleChar = findLineZeroAndInLineIndexZero({
                    editorInfo,
                    globalIndexZero: i,
                });

                if (!foundLineBreakFromClosing) {
                    lastLineHasVisibleChar = true;
                }
                break;
            }
        }
    }

    let optimalLeftOfRange = firstVisibleChar.inLineIndexZero;
    let optimalRightOfRange = lastVisibleChar.inLineIndexZero;

    for (let i = 0; i < allFirstLastNonWhites.length; i += 1) {
        if (
            allFirstLastNonWhites[i].globalIndexZero <
            range.s.globalIndexZero + 1
        ) {
            continue;
        } else if (
            allFirstLastNonWhites[i].globalIndexZero >
            range.e.globalIndexZero - 1
        ) {
            break;
        }

        optimalLeftOfRange = Math.min(
            optimalLeftOfRange,
            allFirstLastNonWhites[i].inLineIndexZero,
        );
        optimalRightOfRange = Math.max(
            optimalRightOfRange,
            allFirstLastNonWhites[i].inLineIndexZero,
        );
    }

    return {
        firstLineHasVisibleChar,
        lastLineHasVisibleChar,
        firstVisibleChar,
        lastVisibleChar,
        optimalLeftOfRange,
        optimalRightOfRange,
    };
};

export const tabsIntoSpaces = (text: string, tabSize: number) => {
    const tabChar = `\t`;
    const spaceChar = ` `;
    const NL = `\n`;

    const currTextArr = text.split("");
    let finalTextArr: string[] = [];

    let currPossibleTabWidth = tabSize;

    currTextArr.map((char: string) => {
        if (char !== tabChar) {
            finalTextArr.push(char);
            if (char === NL) {
                currPossibleTabWidth = tabSize;
            } else if (currPossibleTabWidth > 1) {
                currPossibleTabWidth -= 1;
            } else {
                currPossibleTabWidth = tabSize;
            }
        } else {
            finalTextArr.push(`${spaceChar.repeat(currPossibleTabWidth)}`);
            currPossibleTabWidth = tabSize;
        }
    });

    return finalTextArr.join("");
};

export interface IFullRender {
    masterLevels: {
        s: number;
        e: number;
    }[][];
    allit: IPositionEachZero[];
    macroInfoOfFile: {
        allStartEndIndicators: IPositionEachZero[];
        allFirstLastNonWhitesInEachLine: IPositionEachZero[];
        entireFileLeftMost: number;
        entireFileRightMost: number;
        entireFileTopVisLineZero: number;
        entireFileBottomVisLineZero: number;
    };
    thisEditor: vscode.TextEditor;
    txt: string;

    fileLeftMost: number;
    fileRightMost: number;
    fileBottomVisLineZero: number;
    fileTopVisLineZero: number;
}

export const renderLevels = (
    editorInfo: IEditorInfo,
    firstLineZeroOfRender: number,
    lastLineZeroOfRender: number,
    caller?: "scroll" | "focus" | "edit",
) => {
    // console.log("actual rendering fn");
    let renderingInfo = editorInfo.renderingInfoForFullFile;

    const lang = editorInfo.editorRef.document.languageId;

    if (!renderingInfo) {
        return;
    }

    if (renderingInfo.fileRightMost >= 0 && caller !== "focus") {
        // entire file block
        renderSingleBlock({
            firstLineHasVisibleChar: true,
            lastLineHasVisibleChar: true,
            firstVisibleChar: {
                lineZero: renderingInfo.fileTopVisLineZero,
                inLineIndexZero: renderingInfo.fileLeftMost,
            },
            lastVisibleChar: {
                lineZero: renderingInfo.fileBottomVisLineZero,
                inLineIndexZero: renderingInfo.fileRightMost,
            },
            optimalLeftOfRange: renderingInfo.fileLeftMost,
            optimalRightOfRange: renderingInfo.fileRightMost,

            firstLineZeroOfRender,
            lastLineZeroOfRender,

            depth: 0, // level of entire file is 0
            inDepthBlockIndex: 0, // there is only one block in level/depth 0
            editorInfo,
            lang,
            isFocusedBlock: false,
        });
    }

    // junkDecors3dArr.push(editorInfo.decors); // dangerous
    // editorInfo.decors = []; // dangerous

    // const fDuo = editorInfo.focusDuo; // manage to render and junk only DUO !!!

    // level is same as depth
    // block is same as range
    for (
        let depthMO = 0; // depthMO -> depth minus one
        depthMO < renderingInfo.masterLevels.length;
        depthMO += 1
    ) {
        let level = renderingInfo.masterLevels[depthMO];
        for (let blockIndex = 0; blockIndex < level.length; blockIndex += 1) {
            try {
                let absRangeStartPos = renderingInfo.allit[level[blockIndex].s];
                let absRangeEndPos = renderingInfo.allit[level[blockIndex].e];

                if (absRangeEndPos.lineZero < firstLineZeroOfRender) {
                    continue;
                }

                if (absRangeStartPos.lineZero > lastLineZeroOfRender) {
                    break;
                }

                let isFocusedBlock = false;

                if (caller === "focus") {
                    let isFPrev = false;
                    const fPrev = editorInfo.focusDuo.prev;
                    if (fPrev) {
                        if (
                            depthMO + 1 === fPrev.depth &&
                            blockIndex === fPrev.indexInTheDepth
                        ) {
                            isFPrev = true;
                        }
                    }

                    let isFCurr = false;
                    const fCurr = editorInfo.focusDuo.curr;
                    if (fCurr) {
                        if (
                            depthMO + 1 === fCurr.depth &&
                            blockIndex === fCurr.indexInTheDepth
                        ) {
                            isFCurr = true;
                        }
                    }

                    if (isFPrev || isFCurr) {
                        // cool to go
                        if (isFCurr) {
                            isFocusedBlock = true;
                        }
                    } else {
                        continue;
                    }
                } else {
                    const focusedBlock = editorInfo.focusDuo.curr;

                    if (
                        focusedBlock &&
                        depthMO + 1 === focusedBlock.depth &&
                        blockIndex === focusedBlock.indexInTheDepth
                    ) {
                        isFocusedBlock = true;
                    }
                }

                let theR = {
                    s: absRangeStartPos,
                    e: absRangeEndPos,
                };

                const renderingInfoForBlock = findRenderingInfoForBlock({
                    editorInfo,
                    range: theR,
                    allFirstLastNonWhites:
                        renderingInfo.macroInfoOfFile
                            .allFirstLastNonWhitesInEachLine,
                    workString: renderingInfo.txt,
                });

                if (!renderingInfoForBlock) {
                    continue;
                }

                renderSingleBlock({
                    ...renderingInfoForBlock,
                    editorInfo,
                    depth: depthMO + 1,
                    inDepthBlockIndex: blockIndex,
                    firstLineZeroOfRender,
                    lastLineZeroOfRender,
                    lang,
                    isFocusedBlock,
                    absRangeEndPos,
                } as IBlockRender);
            } catch (err) {
                console.log(err);
            }
        }
    }
    // console.log("done one full render:");
};

// export const getFullFileStatsSecondHelp = (
//     editorInfo: IEditorInfo,
//     document: vscode.TextDocument,
// ) => {

// };

export const stylingLanguages = ["css", "scss", "sass", "less"];

export const getFullFileStats = ({
    editorInfo,
}: {
    editorInfo: IEditorInfo;
}):
    | {
          masterLevels: {
              s: number;
              e: number;
          }[][];
          allit: IPositionEachZero[];
          macroInfoOfFile: {
              allStartEndIndicators: IPositionEachZero[];
              allFirstLastNonWhitesInEachLine: IPositionEachZero[];
              entireFileLeftMost: number;
              entireFileRightMost: number;
              entireFileTopVisLineZero: number;
              entireFileBottomVisLineZero: number;
          };
          thisEditor: vscode.TextEditor;
          txt: string;

          fileLeftMost: number;
          fileRightMost: number;
          fileBottomVisLineZero: number;
          fileTopVisLineZero: number;
      }
    | undefined => {
    // console.log("aqamde vaaartttttttttttttttttttttttt", glo.maxDepth);
    const document = editorInfo.editorRef.document;
    // console.log("iiiiiiiiiiiiii:", document.languageId);

    // let brackets = await bracketManager!.updateDocument(document);

    let txt = document.getText();

    if (getMacroInfoOfFile(editorInfo, txt).entireFileRightMost > 500) {
        return;
    }

    // stylingLanguages
    if (glo.colorDecoratorsInStyles) {
        if (stylingLanguages.includes(document.languageId)) {
            txt = txt.replace(/color:/g, `color:  `);
            txt = txt.replace(/background:/g, `background:  `);
            txt = txt.replace(/fill:/g, `fill:  `);
            txt = txt.replace(/stroke:/g, `stroke:  `);
            txt = txt.replace(/border:/g, `border:  `);

            txt = txt.replace(/border-left:/g, `border-left:  `);
            txt = txt.replace(/border-right:/g, `border-right:  `);
            txt = txt.replace(/border-top:/g, `border-top:  `);
            txt = txt.replace(/border-bottom:/g, `border-bottom:  `);

            txt = txt.replace(/shadow:/g, `shadow:  `);

            txt = txt.replace(/gradient\(/g, `    gradient(`);

            // txt = txt.replace(/rgb\(/g, `  rgb(`);
            // txt = txt.replace(/rgba\(/g, `  rgba(`);

            // txt = txt.replace(/hsl\(/g, `  hsl(`);
            // txt = txt.replace(/hsla\(/g, `  hsla(`);
        } else if (["json", "jsonc"].includes(document.languageId)) {
            txt = txt.replace(/Background":/g, `Background":  `);
            txt = txt.replace(/Border":/g, `Border":  `);
            txt = txt.replace(/Color":/g, `Color":  `);
        }
    }

    if (document.eol === 2) {
        txt = txt.replace(/\r/g, ``); // may be needed, LF, CRLF
    }

    const tabSize = editorInfo.editorRef.options.tabSize;

    if (tabSize && typeof tabSize === "number") {
        txt = tabsIntoSpaces(txt, tabSize);
    } else {
        txt = tabsIntoSpaces(txt, 4); // 4 as default tab size
    }

    txt = txt + ` \n \n `;
    generateTextLinesMap(txt, editorInfo);

    let brackets: IPositionEachZero[] = [];
    let generalStarterBrackets = ["{", "(", "["];
    let generalEnderBrackets = ["}", ")", "]"];

    if (
        (glo.analyzeCurlyBrackets ||
            glo.analyzeSquareBrackets ||
            glo.analyzeRoundBrackets) &&
        glo.maxDepth >= 0 &&
        bracketManager &&
        document.languageId !== "plaintext"
    ) {
        /*
        if (babelParser) {
            // if (false) {
            // console.log("shemovediiitttttt");

            const vmap: any = {};
            const rez: IPositionEachZero[] = [];

            let myParsed: File | undefined = undefined;

            try {
                myParsed = babelParser.parse(txt, {
                    // plugins: ["flow", "jsx", "typesript"],
                    plugins: ["flow", "jsx"],
                });
            } catch (err) {
                console.log(err);
            }

            if (myParsed) {
                babelTraverse(myParsed, {
                    // eslint-disable-next-line @typescript-eslint/naming-convention
                    Scopable: (path) => {
                        // console.log("sdfsdf", vmap[(path.scope as any).uid]);
                        if (vmap[(path.scope as any).uid]) {
                            // console.log("aqad - rettuuuurn");
                            // return;
                        } else {
                            // console.log("aqadaaaa");
                            vmap[(path.scope as any).uid] = 1;
                            if (
                                (path.node as any).body &&
                                typeof (path.node as any).body.start ===
                                    "number" &&
                                typeof path.node.end === "number"
                            ) {
                                let gS = (path.node as any).body.start;
                                if (!generalStarterBrackets.includes(txt[gS])) {
                                    gS -= 1;
                                }
                                let gE = (path.node as any).body.end - 1;
                                if (!generalEnderBrackets.includes(txt[gE])) {
                                    gE += 1;
                                }

                                const llS = findLineZeroAndInLineIndexZero({
                                    globalIndexZero: gS,
                                    editorInfo,
                                });
                                const llE = findLineZeroAndInLineIndexZero({
                                    globalIndexZero: gE,
                                    editorInfo,
                                });
                                console.log("llE:::", llE.lineZero);

                                rez.push(
                                    {
                                        type: "s",
                                        globalIndexZero: gS,
                                        lineZero: llS.lineZero,
                                        inLineIndexZero: llS.inLineIndexZero,
                                        char: "<",
                                    },
                                    {
                                        type: "e",
                                        globalIndexZero: gE,
                                        lineZero: llE.lineZero,
                                        inLineIndexZero: llE.inLineIndexZero,
                                        char: ">",
                                    },
                                );
                            }
                        }
                    },
                });
            }

            // brackets = [...brackets, ...rez];
            brackets = rez;
            // console.log("mivanicheeee");
            console.log("rez:", rez);
            // console.log(rez);
        }
        */

        // return;

        let foundbrackets = bracketManager.updateDocument(document, editorInfo);

        if (foundbrackets) {
            const allBrackets = foundbrackets.map((x) => {
                const globalIndexZero =
                    editorInfo.textLinesMap[x.lineZero] + x.inLineIndexZero;

                let type = "";
                if (generalStarterBrackets.includes(x.char)) {
                    type = "s";
                } else if (generalEnderBrackets.includes(x.char)) {
                    type = "e";
                }
                return {
                    globalIndexZero,
                    inLineIndexZero: x.inLineIndexZero,
                    char: x.char,
                    type,
                    lineZero: x.lineZero,
                };
            });

            let curlyBrackets: IPositionEachZero[] = [];
            if (glo.analyzeCurlyBrackets) {
                curlyBrackets = allBrackets.filter((x) =>
                    ["{", "}"].includes(x.char),
                );
            }
            let squareBrackets: IPositionEachZero[] = [];
            if (glo.analyzeSquareBrackets) {
                squareBrackets = allBrackets.filter((x) =>
                    ["[", "]"].includes(x.char),
                );
            }
            let roundBrackets: IPositionEachZero[] = [];
            if (glo.analyzeRoundBrackets) {
                roundBrackets = allBrackets.filter((x) =>
                    ["(", ")"].includes(x.char),
                );
            }

            brackets = [...curlyBrackets, ...squareBrackets, ...roundBrackets];
        } else {
            // console.log("aq titqos returnnnnnnnnnnnnnnnnnnnnn");
            // foundbrackets = [];
            // editorInfo.needToAnalyzeFile = true;
            // updateRender({ editorInfo });
            return;
        }
    }

    // const cursorPos = thisEditor.selection.active;
    // console.log("cursorPos:", cursorPos);
    // document.lineAt(cursorPos).range.end.character;

    let pythonBlocks: IPositionEachZero[] = [];

    // console.log("document.languageId:::::", document.languageId);

    if (glo.analyzeIndentDedentTokens) {
        if (glo.maxDepth >= 0 && document.languageId === "python") {
            // console.log("before py blocks");
            pythonBlocks = pyFn(txt, editorInfo);
            // console.log("after py blocks");

            // txt = txt.replace(/\#/g, ` `); // cool to ignore "#"
        } else {
            // txt = txt.replace(/\/\//g, `  `); // cool to ignore "//"
        }
    }

    editorInfo.monoText = txt;

    let macroInfoOfFile = getMacroInfoOfFile(editorInfo, txt);

    const fileLeftMost = macroInfoOfFile.entireFileLeftMost;
    const fileRightMost = macroInfoOfFile.entireFileRightMost;

    const fileTopVisLineZero = macroInfoOfFile.entireFileTopVisLineZero;
    const fileBottomVisLineZero = macroInfoOfFile.entireFileBottomVisLineZero;

    // console.log("fileLeftMost:", fileLeftMost);
    // console.log("fileRightMost:", fileRightMost);
    // console.log("fileTopVisLineZero:", fileTopVisLineZero);
    // console.log("fileBottomVisLineZero:", fileBottomVisLineZero);

    // console.log("macroInfoOfFile:", macroInfoOfFile);

    let tagsIt: IPositionEachZero[] = [];

    if (
        glo.analyzeTags &&
        glo.maxDepth >= 0 &&
        document.languageId !== "plaintext"
    ) {
        tagsIt = findInnerStartersEndersOfTags({
            editorInfo,
            myString: txt,
        });
    }

    // console.log("tagsIt:", tagsIt);

    let allit: IPositionEachZero[] = [
        // ...macroInfoOfFile.allStartEndIndicators,
        ...brackets,
        ...tagsIt,
        ...pythonBlocks,
    ].sort((a, b) => a.globalIndexZero - b.globalIndexZero);

    // console.log("allit:", allit);

    let masterLevels = findArrayOfNLevelsWithArrayOfBlocksInside(
        allit,
        glo.maxDepth,
    );
    // console.log("masterLevels:", masterLevels);

    return {
        masterLevels: masterLevels,
        allit,
        macroInfoOfFile,
        thisEditor: editorInfo.editorRef,
        txt,

        fileLeftMost,
        fileRightMost,
        fileBottomVisLineZero,
        fileTopVisLineZero,
    };
};