(function () {
  function debugLog(message, error = null) {
    try {
      const url = new URL(window.location.href);

      if (!url.searchParams.has("roadway_debug")) return;

      if (error) {
        console.error(`[Roadway Tag] ${message}`, error);
      } else {
        console.log(`[Roadway Tag] ${message}`);
      }
    } catch {
      return;
    }
  }

  function initializeSegmentAnonymousIdFillerJob() {
    const segmentAnonymousIdFieldNames = ["segment_anon_id", "segment_anon_id__c"];
    
    return runIndefinitely(() => {
      debugLog("Attempting to set Segment anonymous ID");
      const segmentAnonymousId = getSegmentAnonymousId();
      if (!segmentAnonymousId) return false;

      const formFields = segmentAnonymousIdFieldNames
        .map((fieldName) => document.querySelector(`input[name="${fieldName}"]`))
        .filter(Boolean);

      if (segmentAnonymousId && formFields.length > 0) {
        formFields.forEach((field) => {
          field.value = segmentAnonymousId;
        });
        debugLog("Segment anonymous ID set successfully");
        return true;
      }

      debugLog("Segment anonymous ID not found");
      return false;
    }, "set Segment anonymous ID");
  }

  function initializePosthogIdFillerJob() {
    const posthogIdFields = [
      {
        getId: getPosthogDistinctId,
        fieldNames: ["posthog_distinct_id", "posthog_distinct_id__c"],
      },
      {
        getId: getPosthogDeviceId,
        fieldNames: ["posthog_device_id", "posthog_device_id__c"],
      },
    ];

    return runIndefinitely(() => {
      debugLog("Attempting to set PostHog IDs");
      let filledAnyField = false;

      posthogIdFields.forEach(({ getId, fieldNames }) => {
        const posthogId = getId();
        if (!posthogId) return;

        const formFields = fieldNames
          .map((fieldName) =>
            document.querySelector(`input[name="${fieldName}"]`),
          )
          .filter(Boolean);

        // Overwrite rather than fill-if-empty: distinct_id changes when posthog.identify() runs
        formFields.forEach((field) => {
          field.value = posthogId;
          filledAnyField = true;
        });
      });

      if (!filledAnyField) {
        debugLog("PostHog IDs not found");
        return false;
      }

      debugLog("PostHog IDs set successfully");
      return true;
    }, "set PostHog IDs");
  }

  function initializeHubspotFormPseudoIdFillerJob() {
    return runIndefinitely(() => {
      const ga4PseudoIdInputFieldNames = [
        "ga4_pseudo_user_id",
        "ga4_pseudo_user_id__c",
        "user_pseudo_id",
        "pseudo_user_id",
      ];

      const ga4PseudoId = getUserPseudoId();
      const formFields = ga4PseudoIdInputFieldNames
        .map((fieldName) =>
          document.querySelector(`input[name="${fieldName}"]`),
        )
        .filter(Boolean);
      if (ga4PseudoId && formFields.length > 0) {
        formFields.forEach((field) => {
          if (!field.value) {
            field.value = ga4PseudoId;
          }
        });
        return true;
      }
      return false;
    }, "set GA4 pseudo ID");
  }

  function getSegmentAnonymousId() {
    return window.analytics?.user?.()?.anonymousId?.();
  }

  function buildPosthogPersistenceKey(token, config) {
    const persistenceName = config?.persistence_name;
    if (typeof persistenceName === "string" && persistenceName) {
      return `ph_${persistenceName}`;
    }
    if (typeof token !== "string" || !token) return null;

    const normalizedToken = token
      .replace(/\+/g, "PL")
      .replace(/\//g, "SL")
      .replace(/=/g, "EQ");
    return `ph_${normalizedToken}_posthog`;
  }

  function normalizePosthogPersistenceMode(mode) {
    // posthog-js matches modes case-insensitively and falls back to the default
    // localStorage+cookie for unknown values, so the tag must do the same
    const knownModes = [
      "cookie",
      "localstorage",
      "localstorage+cookie",
      "sessionstorage",
      "memory",
    ];
    const normalizedMode =
      typeof mode === "string" ? mode.toLowerCase() : "localstorage+cookie";
    return knownModes.includes(normalizedMode)
      ? normalizedMode
      : "localstorage+cookie";
  }

  let posthogLocalStorageSupported = null;

  function isPosthogLocalStorageSupported() {
    if (posthogLocalStorageSupported !== null) {
      return posthogLocalStorageSupported;
    }

    // Readable localStorage can still be unusable to PostHog when writes are blocked,
    // so mirror its support probe before trusting persisted identities
    const key = "__mplssupport__";
    const value = '"xyz"';
    try {
      window.localStorage.setItem(key, value);
      posthogLocalStorageSupported = window.localStorage.getItem(key) === value;
    } catch (error) {
      posthogLocalStorageSupported = false;
      debugLog("PostHog local storage is unsupported", error);
    }

    try {
      window.localStorage.removeItem(key);
    } catch (error) {
      debugLog("Error removing PostHog local storage probe", error);
    }

    return posthogLocalStorageSupported;
  }

  function getActivePosthogPersistence() {
    try {
      const posthog = window.posthog;
      if (!posthog) return null;

      const configuredKey = buildPosthogPersistenceKey(
        posthog.config?.token,
        posthog.config,
      );
      if (configuredKey) {
        return {
          key: configuredKey,
          mode: normalizePosthogPersistenceMode(posthog.config?.persistence),
        };
      }

      if (!Array.isArray(posthog._i)) return null;
      const rootInitialization = posthog._i.find(
        (initialization) =>
          Array.isArray(initialization) &&
          (initialization[2] === undefined || initialization[2] === "posthog"),
      );
      if (!rootInitialization) return null;

      const snippetKey = buildPosthogPersistenceKey(
        rootInitialization[0],
        rootInitialization[1],
      );
      if (!snippetKey) return null;

      return {
        key: snippetKey,
        mode: normalizePosthogPersistenceMode(
          rootInitialization[1]?.persistence,
        ),
      };
    } catch (error) {
      debugLog("Error resolving active PostHog persistence key", error);
      return null;
    }
  }

  function resolvePosthogPersistence(cookies, persistenceKeyPattern) {
    const activePersistence = getActivePosthogPersistence();
    if (activePersistence) return activePersistence;

    const candidateKeys = new Set(
      cookies
        .map((cookie) => cookie.split("=")[0])
        .filter((key) => persistenceKeyPattern.test(key)),
    );

    try {
      Object.keys(window.localStorage)
        .filter((key) => persistenceKeyPattern.test(key))
        .forEach((key) => candidateKeys.add(key));
    } catch (error) {
      debugLog("Error inspecting PostHog local storage keys", error);
    }

    if (candidateKeys.size === 1) {
      // No reachable SDK config to say which store is live, so read both
      return {
        key: candidateKeys.values().next().value,
        mode: "localstorage+cookie",
      };
    }
    if (candidateKeys.size > 1) {
      debugLog(
        "Multiple PostHog persistence keys found without an active project",
      );
    }
    return null;
  }

  function getPosthogPersistedState() {
    // posthog-js mirrors its state to a ph_<project_token>_posthog cookie and local storage entry.
    // Reading those directly keeps the ids available before init() finishes, and when the SDK is
    // loaded into a scope the tag cannot reach.
    const persistenceKeyPattern = /^ph_.+_posthog$/;

    let cookies = [];
    try {
      cookies = document.cookie
        ? document.cookie.split(";").map((cookie) => cookie.trim())
        : [];
    } catch (error) {
      debugLog("Error reading PostHog cookies", error);
    }

    const persistence = resolvePosthogPersistence(
      cookies,
      persistenceKeyPattern,
    );
    if (!persistence) {
      debugLog("No unambiguous PostHog persistence key found");
      return null;
    }

    // The tag cannot know whether its independent probe matches PostHog's cached
    // result, so fail closed rather than risk choosing a stale fallback store
    if (
      (persistence.mode === "localstorage" ||
        persistence.mode === "localstorage+cookie") &&
      !isPosthogLocalStorageSupported()
    ) {
      debugLog("PostHog local storage is unsupported; skipping persisted IDs");
      return null;
    }

    // sessionStorage and memory modes store nothing the tag can read, and any
    // cookie or local storage entry left behind by an earlier mode is stale
    if (
      persistence.mode === "sessionstorage" ||
      persistence.mode === "memory"
    ) {
      debugLog("PostHog persistence mode keeps no state the tag can read");
      return null;
    }

    let cookieState = null;
    try {
      if (persistence.mode !== "localstorage") {
        const posthogCookie = cookies.find(
          (cookie) => cookie.split("=")[0] === persistence.key,
        );
        if (posthogCookie) {
          const rawValue = posthogCookie.slice(posthogCookie.indexOf("=") + 1);
          cookieState = JSON.parse(decodeURIComponent(rawValue));
        }
      }
    } catch (error) {
      debugLog("Error parsing PostHog cookie", error);
    }

    let localStorageState = null;
    try {
      if (persistence.mode !== "cookie") {
        localStorageState = JSON.parse(
          window.localStorage.getItem(persistence.key),
        );
      }
    } catch (error) {
      debugLog("Error parsing PostHog local storage entry", error);
    }

    if (!cookieState && !localStorageState) {
      debugLog("No PostHog persisted state found");
      return null;
    }

    // Merge with local storage winning, matching posthog-js's own read path: the cookie only
    // mirrors a property subset, best-effort, so it can be partial or go stale on write failures
    return { ...cookieState, ...localStorageState };
  }

  function getPosthogDistinctId() {
    if (window.posthog?.__loaded) {
      const distinctId = window.posthog.get_distinct_id();
      if (distinctId) return distinctId;
    }
    return getPosthogPersistedState()?.distinct_id ?? null;
  }

  function getPosthogDeviceId() {
    if (window.posthog?.__loaded) {
      const deviceId = window.posthog.get_property("$device_id");
      if (deviceId) return deviceId;
    }
    return getPosthogPersistedState()?.["$device_id"] ?? null;
  }

  function getUserPseudoId() {
    debugLog("Attempting to get user pseudo ID");
    try {
      if (!document.cookie) {
        debugLog("No cookies found");
        return null;
      }
      // Split by semicolon and trim each cookie to handle cases with or without spaces
      const cookies = document.cookie.split(";").map((cookie) => cookie.trim());
      const gaCookie = cookies.find(
        (row) => row.startsWith("_ga=") && !row.includes("_gat"),
      );
      if (!gaCookie) {
        debugLog("No _ga cookie found");
        return null;
      }
      const pseudoId = gaCookie.split("=")[1].split(".").slice(-2).join(".");
      debugLog(`Found pseudo ID: ${pseudoId}`);
      return pseudoId;
    } catch (error) {
      debugLog("Error retrieving user pseudo ID:", error);
      return null;
    }
  }
  function runIndefinitely(operation, name, interval = 1500) {
    setInterval(function () {
      debugLog(`Attempting ${name}`);
      try {
        operation();
      } catch (error) {
        debugLog(`Error in ${name}:`, error);
      }
    }, interval);
  }

  function validateGa4Configuration() {
    if (typeof window.gtag === "function" && window.dataLayer) {
      const ga4Config = window.dataLayer.find(
        (entry) => entry[0] === "config" && entry[1]?.startsWith("G-"),
      );
      if (ga4Config) {
        debugLog(
          `GA4 is properly configured with Measurement ID: ${ga4Config[1]}`,
        );
        return true;
      } else {
        debugLog(
          "GA4 is NOT properly configured. No valid Measurement ID found.",
        );
        return false;
      }
    }
    debugLog("GA4 is NOT properly configured. gtag or dataLayer is missing");
    return false;
  }

  function validatePosthogConfiguration() {
    // The PostHog snippet stubs capture() immediately so events can queue before the SDK finishes loading.
    if (typeof window.posthog?.capture === "function") {
      if (window.posthog.__loaded) {
        debugLog(
          `PostHog is properly configured with project token: ${window.posthog.config?.token}`,
        );
      } else {
        debugLog("PostHog capture queue is available before SDK load");
      }
      return true;
    }
    debugLog(
      "PostHog is NOT properly configured. posthog capture is missing",
    );
    return false;
  }

  function getHubspotUtkCookie() {
    try {
      const cookies = document.cookie.split(";");
      const cookieName = "hubspotutk=";

      for (let cookie of cookies) {
        try {
          cookie = cookie.trim();
          if (cookie.indexOf(cookieName) === 0) {
            return cookie.substring(cookieName.length).replace(/[^\w-]/g, "");
          }
        } catch (innerError) {
          debugLog("Error processing individual cookie", innerError);
          continue;
        }
      }
      return null;
    } catch (error) {
      debugLog("Error accessing or parsing cookies", error);
      return null;
    }
  }

  function getHubspotFormSubmissionParameters(event) {
    // Check if hostname contains canibuild.com (works for subdomains too)
    // for canibuild, we have to use the hubspot_form_id as the utk cookie value
    const isCanibuild = window.location.hostname.includes("canibuild.com");

    if (isCanibuild) {
      return {
        hubspot_form_id: getHubspotUtkCookie(),
      };
    } else {
      return {
        hubspot_form_id: event?.data?.id,
        hubspot_utk: getHubspotUtkCookie(),
      };
    }
  }

  function triggerGa4EventForHubspotFormSubmission(eventData) {
    if (validateGa4Configuration()) {
      debugLog("Sending event via gtag");
      window.gtag("event", "hubspot_form_submission", eventData);
    } else {
      debugLog("gtag not available, falling back to dataLayer");
      // If gtag isn't available, we can fallback to pushing the event into the dataLayer
      // This requires that you have Google Tag Manager set up to handle 'hubspot_form_submission' events
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push({
        event: "hubspot_form_submission",
        ...eventData,
      });
    }
  }

  function triggerPosthogEventForHubspotFormSubmission(eventData) {
    if (!validatePosthogConfiguration()) {
      debugLog("posthog not available, skipping PostHog event");
      return;
    }

    debugLog("Sending event via posthog.capture");
    window.posthog.capture("hubspot_form_submission", eventData);
  }

  function triggerEventsForHubspotFormSubmission(eventData) {
    // Contained per destination: a throwing vendor SDK must not surface as an uncaught error
    // on the customer's page, nor suppress the other destination. posthog-js does not guard
    // customer-written before_send hooks, so posthog.capture() can legitimately throw.
    try {
      triggerGa4EventForHubspotFormSubmission(eventData);
    } catch (error) {
      debugLog("Error sending GA4 event:", error);
    }
    try {
      triggerPosthogEventForHubspotFormSubmission(eventData);
    } catch (error) {
      debugLog("Error sending PostHog event:", error);
    }
  }

  function initializeHubspotFormSubmissionListener() {
    window.addEventListener("message", function (event) {
      if (
        event.data?.type === "hsFormCallback" &&
        event.data.eventName === "onFormSubmit"
      ) {
        debugLog("onFormSubmit callback received. Event: ", event);

        const eventData = getHubspotFormSubmissionParameters(event);
        debugLog("Event data prepared:", eventData);

        triggerEventsForHubspotFormSubmission(eventData);
      }
    });
  }

  function initializeHubspotListenerForAnyFormSubmission() {
    window.addEventListener("submit", function (event) {
      try {
        debugLog("Form submitted:", event);
        const eventData = getHubspotFormSubmissionParameters(event);
        debugLog("Event Data:", eventData);

        triggerEventsForHubspotFormSubmission(eventData);
      } catch (error) {
        debugLog("Error in submit event listener:", error);
      }
    });
  }

  async function main() {
    debugLog("Starting main execution");
    initializeHubspotFormSubmissionListener();
    initializeHubspotFormPseudoIdFillerJob();
    initializeSegmentAnonymousIdFillerJob();
    initializePosthogIdFillerJob();
    initializeHubspotListenerForAnyFormSubmission();

    setTimeout(() => {
      // if debug is enabled, this is good for us to check if ga4 is configured
      validateGa4Configuration();
      validatePosthogConfiguration();
    }, 5000);
  }

  function initializeRoadwayTag() {
    // Handle initial page load
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", main);
    } else {
      main();
    }
  }

  initializeRoadwayTag();
})();
