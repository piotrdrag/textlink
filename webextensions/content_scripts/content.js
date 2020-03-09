/*
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
*/
'use strict';

gLogContext = 'content';

let gTryingAction = false;
let gLastActionResult = null;
let gMatchAllProgress = 0;

async function onDblClick(aEvent) {
  if (aEvent.target.ownerDocument != document)
    return;
  const data = getSelectionEventData(aEvent);
  if (!data)
    return;
  gTryingAction = true;
  gLastActionResult = null;
  const textFieldSelection = isInputField(aEvent.target);
  gLastActionResult = await browser.runtime.sendMessage(Object.assign({}, data, {
    type: kCOMMAND_TRY_ACTION
  }));
  if (textFieldSelection &&
      gLastActionResult &&
      gLastActionResult.range)
    gLastActionResult.range.fieldNodePos = getFieldNodePosition(aEvent.target);
  postAction(gLastActionResult);
  await wait(500);
  gTryingAction = false;
}

async function onKeyUp(aEvent) {
  if (aEvent.target.ownerDocument != document)
    return;
  const data = getSelectionEventData(aEvent);
  if (!data)
    return;
  gTryingAction = true;
  gLastActionResult = null;
  const textFieldSelection = isInputField(aEvent.target);
  gLastActionResult = await browser.runtime.sendMessage(Object.assign({}, data, {
    type: kCOMMAND_TRY_ACTION
  }));
  if (textFieldSelection &&
      gLastActionResult &&
      gLastActionResult.range)
    gLastActionResult.range.fieldNodePos = getFieldNodePosition(aEvent.target);
  postAction(gLastActionResult);
  gTryingAction = false;
}

function postAction(aResult) {
  if (!aResult)
    return;

  if (aResult.action & kACTION_COPY)
    doCopy(aResult.uri);
  if (aResult.range)
    selectRanges(aResult.range);
}

function doCopy(aText) {
  gChangingSelectionRangeInternally++;
  const selection = window.getSelection();
  const ranges = [];
  for (let i = 0, maxi = selection.rangeCount; i < maxi; i++) {
    ranges.push(getRangeData(selection.getRangeAt(i)));
  }

  // this is required to block overriding clipboard data from scripts of the webpage.
  document.addEventListener('copy', aEvent => {
    aEvent.stopImmediatePropagation();
    aEvent.preventDefault();
    aEvent.clipboardData.setData('text/plain', aText);
  }, {
    capture: true,
    once: true
  });

  const field = document.createElement('textarea');
  field.value = aText;
  document.body.appendChild(field);
  field.style.position = 'fixed';
  field.style.opacity = 0;
  field.style.pointerEvents = 'none';
  field.focus();
  field.select();
  document.execCommand('copy');
  field.parentNode.removeChild(field);

  selectRanges(ranges);
  gChangingSelectionRangeInternally--;
}


let gLastSelection = '';
let gFindingURIRanges = false;
let gLastSelectionChangeAt = 0;
let gLastURIRanges = Promise.resolve([]);
var gChangingSelectionRangeInternally = 0;

async function onSelectionChange(aEvent) {
  if (gChangingSelectionRangeInternally > 0)
    return;

  const changedAt = gLastSelectionChangeAt = Date.now();
  if (findURIRanges.delayed)
    clearTimeout(findURIRanges.delayed);

  await wait(200);
  if (changedAt != gLastSelectionChangeAt)
    return;

  if (gTryingAction) {
    while (gTryingAction) {
      await wait(500);
    }
    if (changedAt != gLastSelectionChangeAt)
      return;
    if (gLastActionResult) {
      gLastURIRanges = Promise.resolve([gLastActionResult]);
      return;
    }
  }

  if (isInputField(aEvent.target))
    onTextFieldSelectionChanged(aEvent.target);
  else
    onSelectionRangeChanged();
}

function onTextFieldSelectionChanged(aField) {
  const selectionRange = getFieldRangeData(aField);

  gLastSelection    = selectionRange.text.substring(selectionRange.startOffset, selectionRange.endOffset);
  gFindingURIRanges = true;

  browser.runtime.sendMessage({
    type: kNOTIFY_READY_TO_FIND_URI_RANGES
  });
  gLastURIRanges = new Promise(async (aResolve, aReject) => {
    const ranges = await browser.runtime.sendMessage({
      type:   kCOMMAND_FIND_URI_RANGES,
      base:   location.href,
      ranges: [selectionRange]
    });
    const position = getFieldNodePosition(aField);
    for (const range of ranges) {
      range.range.fieldNodePos = position;
    }
    gFindingURIRanges = false;
    aResolve(ranges);
  });
}

function onSelectionRangeChanged() {
  const selection     = window.getSelection();
  const selectionText = selection.toString()
  if (selectionText == gLastSelection)
    return;

  gLastSelection    = selectionText;
  gFindingURIRanges = true;

  browser.runtime.sendMessage({
    type: kNOTIFY_READY_TO_FIND_URI_RANGES
  });

  findURIRanges.delayed = setTimeout(() => {
    delete findURIRanges.delayed;
    gLastURIRanges = findURIRanges();
  }, 100);
}

async function findURIRanges(aOptions = {}) {
  const selection = window.getSelection();
  if (!selection.toString().trim()) {
    browser.runtime.sendMessage({
      type:   kCOMMAND_FIND_URI_RANGES,
      base:   location.href,
      ranges: []
    });
    return [];
  }

  const selectionRanges = [];
  for (let i = 0, maxi = selection.rangeCount; i < maxi; i++) {
    const selectionRange = selection.getRangeAt(i);
    const selectionText  = rangeToText(selectionRange);
    const preceding      = getPrecedingRange(selectionRange);
    const following      = getFollowingRange(selectionRange);
    const rangeData      = getRangeData(selectionRange);
    if (!aOptions.includeRange) {
      rangeData.startNodePos = rangeData.startTextNodePos;
      delete rangeData.startTextNodePos;
      delete rangeData.endTextNodePos;
      rangeData.startOffset += preceding.text.length;
      rangeData.endOffset   = preceding.text.length + selectionText.length - (selectionRange.endContainer.nodeValue - selectionRange.endOffset);
    }
    rangeData.text = `${preceding.text}${selectionText}${following.text}`;
    selectionRanges.push(rangeData);
  }
  const ranges = await browser.runtime.sendMessage({
    type:   kCOMMAND_FIND_URI_RANGES,
    base:   location.href,
    ranges: selectionRanges
  });
  gFindingURIRanges = false;
  return ranges;
}

function getSelectionEventData(aEvent) {
  const textFieldSelection = isInputField(aEvent.target);

  const selection = window.getSelection();
  if (!textFieldSelection && selection.rangeCount != 1)
    return null;

  let text, cursor;
  if (textFieldSelection) {
    cursor = getFieldRangeData(aEvent.target);
    text   = cursor.text;
  }
  else {
    const selectionRange = selection.getRangeAt(0);
    const preceding      = getPrecedingRange(selectionRange);
    const following      = getFollowingRange(selectionRange);
    text   = `${preceding.text}${rangeToText(selectionRange)}${following.text}`;
    cursor = getRangeData(selectionRange);
  }

  const data = {
    text, cursor,
    base:  location.href,
    event: {
      altKey:   aEvent.altKey,
      ctrlKey:  aEvent.ctrlKey,
      metaKey:  aEvent.metaKey,
      shiftKey: aEvent.shiftKey,
      inEditable: textFieldSelection || isEditableNode(aEvent.target)
    }
  };

  if (aEvent.type == 'dblclick' &&
      aEvent.button == 0) {
    data.event.type = 'dblclick';
  }
  else if (aEvent.type == 'keyup' &&
           aEvent.key == 'Enter') {
    data.event.type = 'enter';
  }
  else {
    return null;
  }
  return data;
}


function onFocused(aEvent) {
  const node = aEvent.target;
  if (!isInputField(node))
    return;
  node.addEventListener('selectionchange', onSelectionChange, { capture: true });
  window.addEventListener('unload', () => {
    node.removeEventListener('selectionchange', onSelectionChange, { capture: true });
  }, { once: true });
}

function isInputField(aNode) {
  return (
    aNode.nodeType == Node.ELEMENT_NODE &&
    evaluateXPath(`self::*[${kFIELD_CONDITION}]`, aNode, XPathResult.BOOLEAN_TYPE).booleanValue
  );
}

function isEditableNode(aNode) {
  if ((aNode.ownerDocument || aNode).designMode == 'on')
    return true;
  while (aNode) {
    if (aNode.contentEditable == 'true')
      return true;
    aNode = aNode.parentNode;
  }
  return false;
}


function onMessage(aMessage, aSender) {
  switch (aMessage.type) {
    case kCOMMAND_ACTION_FOR_URIS: return (async () => {
      let ranges = await gLastURIRanges;
      if (aMessage.action & kACTION_COPY) {
        let uris = ranges.map(aRange => aRange.uri).join('\n');
        if (ranges.length > 1)
          uris += '\n';
        doCopy(uris);
      }
      else {
        browser.runtime.sendMessage(Object.assign({}, aMessage, {
          uris: ranges.map(aRange => aRange.uri)
        }));
      }
      if (ranges.length > 0 &&
          (!('startTextNodePos' in ranges[0]) ||
           !('endTextNodePos' in ranges[0]))) {
        gLastURIRanges = findURIRanges({
          includeRange: true
        });
        ranges = await gLastURIRanges;
      }
      selectRanges(ranges.map(aRange => aRange.range));
    })();

    case kCOMMAND_FETCH_URI_RANGES:
      return gLastURIRanges;

    case kNOTIFY_MATCH_ALL_PROGRESS:
      gMatchAllProgress = aMessage.progress;
      if (aMessage.showInContent)
        updateProgress();
      break;

    case kCOMMAND_FETCH_MATCH_ALL_PROGRESS:
      return Promise.resolve(gMatchAllProgress);
  }
}

let gProgressIndicator;

function updateProgress() {
  if (gMatchAllProgress >= 100 || gMatchAllProgress <= 0) {
    if (gProgressIndicator) {
      gProgressIndicator.parentNode.removeChild(gProgressIndicator);
      gProgressIndicator = null;
    }
    return;
  }

  if (!gProgressIndicator) {
    const range = document.createRange();
    range.selectNodeContents(document.body || document.documentElement);
    range.collapse(false);
    const fragment = range.createContextualFragment(`<span style="
      bottom: 0.5em;
      box-shadow: 0 0 0.2em rgba(0, 0, 0, 0.5),
                  0 0 0.2em rgba(0, 0, 0, 0.5);
      display: block;
      font-size: medium;
      height: 0.2em;
      max-height: 0.2em;
      max-width: 5em;
      opacity: 1;
      padding: 0;
      position: fixed;
      right: 0.5em;
      width: 5em;
    "></span>`);
    gProgressIndicator = fragment.firstChild;
    range.insertNode(fragment);
    range.detach();
  }
  gProgressIndicator.style.background = `
    linear-gradient(to right,
                    #24b7b7 0%,
                    #85f2e1 ${gMatchAllProgress}%,
                    #000000 ${gMatchAllProgress}%,
                    #000000 100%)
  `;
  gProgressIndicator.setAttribute('title', browser.i18n.getMessage('menu_waiting_label', [gMatchAllProgress]));
}

window.addEventListener('dblclick', onDblClick, { capture: true });
window.addEventListener('keyup', onKeyUp, { capture: true });
window.addEventListener('selectionchange', onSelectionChange, { capture: true });
window.addEventListener('focus', onFocused, { capture: true });
browser.runtime.onMessage.addListener(onMessage);

window.addEventListener('unload', () => {
  window.removeEventListener('dblclick', onDblClick, { capture: true });
  window.removeEventListener('keyup', onKeyUp, { capture: true });
  window.removeEventListener('selectionchange', onSelectionChange, { capture: true });
  window.removeEventListener('focus', onFocused, { capture: true });
  browser.runtime.onMessage.removeListener(onMessage);
}, { once: true });

