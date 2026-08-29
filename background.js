chrome.action.onClicked.addListener((tab) => {
  chrome.windows.create({
    url: chrome.runtime.getURL(`capture.html?windowId=${tab.windowId}`),
    type: 'popup',
    width: 460,
    height: 420
  });
});
