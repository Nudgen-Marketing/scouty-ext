/* global sessionStorage */
// SYNTHETIC page behaviour for the mock LinkedIn server. It plays the part of the page's own
// scripts: it shows the rest of a text when "…see more" is pressed, loads more blocks, and can
// turn into a checkpoint. It also keeps a log of EVERY click on the page, which the e2e suite
// reads to prove the extension pressed nothing but the expand and load-more controls.
(function () {
  var KEY = "__mock_clicks";
  function log(entry) {
    var all = JSON.parse(sessionStorage.getItem(KEY) || "[]");
    all.push(entry);
    sessionStorage.setItem(KEY, JSON.stringify(all));
  }
  document.addEventListener("click", function (event) {
    var el = event.target;
    log({ tag: el.tagName.toLowerCase(), cls: el.getAttribute("class") || "", text: (el.textContent || "").trim().slice(0, 40), path: location.pathname, trusted: event.isTrusted });
    if (el.matches("button[aria-expanded='false']")) {
      var rest = el.parentElement && el.parentElement.querySelector("[data-rest]");
      if (rest) rest.removeAttribute("hidden");
      el.remove();
    }
    if (el.matches("button.scaffold-finite-scroll__load-button")) el.remove();
  }, true);

  var body = document.body;
  var lazyTotal = Number(body.getAttribute("data-lazy-total") || 0);
  var lazyStep = Number(body.getAttribute("data-lazy-step") || 0);
  var checkpointAfter = Number(body.getAttribute("data-checkpoint-after") || 0);
  var scrolls = 0;
  var made = document.querySelectorAll(".feed-shared-update-v2").length;
  function addBlock(n) {
    var list = document.querySelector(".scaffold-finite-scroll__content");
    if (!list) return;
    var block = document.createElement("div");
    block.className = "feed-shared-update-v2";
    block.setAttribute("data-urn", "urn:li:activity:71303168000000" + String(10000 + n));
    var text = document.createElement("div");
    text.className = "update-components-text";
    text.textContent = "Synthetic lazy post number " + n + ".";
    block.appendChild(text);
    list.appendChild(block);
  }
  window.addEventListener("scroll", function () {
    scrolls += 1;
    if (checkpointAfter && scrolls === checkpointAfter) {
      var captcha = document.createElement("div");
      captcha.id = "captcha-internal";
      captcha.textContent = "Synthetic security check";
      document.body.appendChild(captcha);
    }
    for (var i = 0; i < lazyStep && made < lazyTotal; i += 1) {
      made += 1;
      addBlock(made);
    }
  });
})();
