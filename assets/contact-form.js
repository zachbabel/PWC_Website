/**
 * Petaluma Wrestling Club — contact form submission handler.
 *
 * GitHub Pages only serves static files, so the actual form processing
 * (validation + emailing the club) happens in a Cloudflare Worker. This
 * script just validates on the client for instant feedback, then POSTs
 * the data to that Worker as JSON and reports back success/error without
 * a page reload.
 *
 * SETUP: after deploying the Worker (see /cloudflare-worker/README.md),
 * replace the placeholder URL below with your Worker's actual URL.
 */
(function () {
	"use strict";

	// Replace with your deployed Worker URL, e.g.
	// "https://pwc-contact-form.YOUR-SUBDOMAIN.workers.dev"
	var WORKER_URL = "https://pwc-contact-form.pwc-contact-form.workers.dev";

	// TODO: replace with your Turnstile widget's Site Key (public — safe to
	// commit). See cloudflare-worker/README.md for how to create one.
	var TURNSTILE_SITE_KEY = "0x4AAAAAAEHeIN4QaTsewefm";

	var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
	var turnstileWidgetId = null;

	// Called by Cloudflare's Turnstile script (see the ?onload= param on its
	// <script> tag in contact/index.html) once its API is ready. Defined at
	// top level, outside DOMContentLoaded, because Turnstile's script runs
	// (and may call this) before DOMContentLoaded fires — the #pwc-turnstile
	// container is still available by then since it's static HTML, not
	// something this script creates.
	window.pwcTurnstileOnLoad = function () {
		var container = document.getElementById("pwc-turnstile");
		if (!container || typeof turnstile === "undefined") return;
		turnstileWidgetId = turnstile.render(container, {
			sitekey: TURNSTILE_SITE_KEY,
		});
	};

	function resetTurnstile() {
		if (turnstileWidgetId !== null && typeof turnstile !== "undefined") {
			turnstile.reset(turnstileWidgetId);
		}
	}

	document.addEventListener("DOMContentLoaded", function () {
		var form = document.getElementById("pwc-contact-form");
		if (!form) return;

		var submitBtn = document.getElementById("pwc-submit-btn");
		var successMsg = document.getElementById("pwc-success-msg");
		var errorMsg = document.getElementById("pwc-error-msg");

		var nameInput = document.getElementById("pwc-name");
		var emailInput = document.getElementById("pwc-email");
		var messageInput = document.getElementById("pwc-message");
		var honeypotInput = document.getElementById("pwc-website");

		function setFieldError(input, hasError) {
			var group = input.closest(".fl-input-group");
			if (!group) return;
			group.classList.toggle("fl-error", hasError);
			input.setAttribute("aria-invalid", hasError ? "true" : "false");
		}

		function validate() {
			var isValid = true;

			if (nameInput.value.trim() === "") {
				setFieldError(nameInput, true);
				isValid = false;
			} else {
				setFieldError(nameInput, false);
			}

			if (emailInput.value.trim() === "" || !EMAIL_RE.test(emailInput.value.trim())) {
				setFieldError(emailInput, true);
				isValid = false;
			} else {
				setFieldError(emailInput, false);
			}

			if (messageInput.value.trim() === "") {
				setFieldError(messageInput, true);
				isValid = false;
			} else {
				setFieldError(messageInput, false);
			}

			return isValid;
		}

		function setLoading(isLoading) {
			if (isLoading) {
				submitBtn.classList.add("fl-disabled");
				submitBtn.setAttribute("aria-disabled", "true");
				submitBtn.querySelector(".fl-button-text").textContent = "Sending...";
			} else {
				submitBtn.classList.remove("fl-disabled");
				submitBtn.setAttribute("aria-disabled", "false");
				submitBtn.querySelector(".fl-button-text").textContent = "Send";
			}
		}

		function showSuccess() {
			successMsg.style.display = "inline-block";
			errorMsg.style.display = "none";
			form.reset();
		}

		function showError(message) {
			errorMsg.textContent = message || "Something went wrong. Please try again or email us directly.";
			errorMsg.style.display = "inline-block";
			successMsg.style.display = "none";
		}

		function handleSubmit(e) {
			e.preventDefault();

			if (submitBtn.classList.contains("fl-disabled")) return;

			successMsg.style.display = "none";
			errorMsg.style.display = "none";

			if (!validate()) return;

			var turnstileToken =
				turnstileWidgetId !== null && typeof turnstile !== "undefined"
					? turnstile.getResponse(turnstileWidgetId)
					: "";

			if (!turnstileToken) {
				showError("Please wait a moment for the verification check to finish, then try again.");
				return;
			}

			setLoading(true);

			fetch(WORKER_URL, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: nameInput.value.trim(),
					email: emailInput.value.trim(),
					message: messageInput.value.trim(),
					// Honeypot — should always be empty for real visitors.
					website: honeypotInput.value,
					turnstileToken: turnstileToken,
				}),
			})
				.then(function (response) {
					return response
						.json()
						.catch(function () {
							return {};
						})
						.then(function (data) {
							if (!response.ok || !data.success) {
								throw new Error((data && data.error) || "Failed to send message.");
							}
							return data;
						});
				})
				.then(function () {
					setLoading(false);
					showSuccess();
					resetTurnstile();
				})
				.catch(function (err) {
					setLoading(false);
					showError(err.message);
					resetTurnstile();
				});
		}

		form.addEventListener("submit", handleSubmit);
		submitBtn.addEventListener("click", handleSubmit);
		submitBtn.addEventListener("keydown", function (e) {
			if (e.key === "Enter" || e.key === " ") {
				handleSubmit(e);
			}
		});
	});
})();
