const checkbox = document.getElementById("fold-by-default");

chrome.storage.sync.get({ foldByDefault: false }).then(({ foldByDefault }) => {
  checkbox.checked = foldByDefault;
});

checkbox.addEventListener("change", () => {
  chrome.storage.sync.set({ foldByDefault: checkbox.checked });
  chrome.storage.local.set({ foldOverrides: {} });
});
