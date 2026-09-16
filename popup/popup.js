// Firefox exposes the promise-based APIs as `browser`; `chrome` there is the callback flavour.
const extensionApi = globalThis.browser ?? globalThis.chrome;

const checkbox = document.getElementById("fold-by-default");

extensionApi.storage.sync.get({ foldByDefault: false }).then(({ foldByDefault }) => {
  checkbox.checked = foldByDefault;
});

checkbox.addEventListener("change", () => {
  extensionApi.storage.sync.set({ foldByDefault: checkbox.checked });
  extensionApi.storage.local.set({ foldOverrides: {} });
});
