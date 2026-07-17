export const scenarios = [
  {
    id: "data-leak",
    title: "Sensitive Export Sprint",
    domain: "Data Privacy",
    risk: "Unapproved data sharing",
    actor: "Sales Director",
    timeLimit: 28,
    brief:
      "A senior stakeholder asks Operations to send client records outside approved channels before a board update.",
    artifact: {
      label: "Email Artifact",
      title: "Client export request",
      body:
        "Need full client export in 10 minutes. Corporate mail is slow, so send it to my personal email. MD is waiting.",
    },
    steps: [
      {
        event:
          "The file contains account numbers, phone numbers, email addresses, and relationship notes.",
        prompt: "What is your first action?",
        choices: [
          {
            label: "Send the file because the request is senior and urgent.",
            score: -20,
            control: -28,
            feedback:
              "Urgency does not remove the approved-channel requirement. This creates direct leakage risk.",
          },
          {
            label: "Pause, verify business need, and use the secure transfer process.",
            score: 28,
            control: 18,
            feedback:
              "Strong control move. You preserved urgency while keeping transfer inside approved systems.",
          },
          {
            label: "Refuse with no explanation and close the ticket.",
            score: 6,
            control: 4,
            feedback:
              "Blocking is safer than sending, but the stakeholder still needs a clear approved path.",
          },
        ],
      },
      {
        event:
          "The director replies: 'If this misses the meeting, the desk will blame Operations.'",
        prompt: "How do you handle the pressure?",
        choices: [
          {
            label: "Document the pressure and escalate to the data owner/compliance.",
            score: 24,
            control: 16,
            feedback:
              "Good escalation. You made the risk auditable and moved the decision to the right owner.",
          },
          {
            label: "Send only half the file to personal email.",
            score: -14,
            control: -18,
            feedback:
              "Reducing the data does not fix the uncontrolled channel or authorization gap.",
          },
          {
            label: "Ask them to promise they will delete it later.",
            score: -10,
            control: -14,
            feedback:
              "A promise is not a control. Approved transfer and authorization still matter.",
          },
        ],
      },
    ],
  },
  {
    id: "payment-release",
    title: "Two-Minute Payment Release",
    domain: "AML",
    risk: "Questionable payment under client pressure",
    actor: "Relationship Manager",
    timeLimit: 24,
    brief:
      "A high-value client threatens to move business unless a payment with unusual beneficiary details is released immediately.",
    artifact: {
      label: "Payment Alert",
      title: "Beneficiary mismatch",
      body:
        "Payment amount is 4.8x normal pattern. Beneficiary country changed today. Purpose field says 'consulting support'.",
    },
    steps: [
      {
        event:
          "The payment alert is still open and the beneficiary details do not match the onboarding file.",
        prompt: "Choose the release decision.",
        choices: [
          {
            label: "Release now and review the alert after close of business.",
            score: -24,
            control: -30,
            feedback:
              "That reverses the control order. Alert review must happen before release.",
          },
          {
            label: "Hold release, request support, and escalate the open alert.",
            score: 30,
            control: 20,
            feedback:
              "Correct. Payment pressure cannot override unresolved AML indicators.",
          },
          {
            label: "Ask the relationship manager if the client seems trustworthy.",
            score: 2,
            control: -4,
            feedback:
              "Relationship context helps, but it cannot replace alert resolution and evidence.",
          },
        ],
      },
      {
        event:
          "The client sends a new invoice with different wording but the same beneficiary account.",
        prompt: "What evidence matters now?",
        choices: [
          {
            label: "Treat the new invoice as enough because the amount matches.",
            score: -12,
            control: -14,
            feedback:
              "Matching amount is thin evidence. The beneficiary change remains unresolved.",
          },
          {
            label: "Compare ownership, payment purpose, and source of funds before release.",
            score: 24,
            control: 14,
            feedback:
              "Good investigation path. You focused on the mismatch instead of the document volume.",
          },
          {
            label: "Tell the client compliance is blocking them personally.",
            score: -4,
            control: -8,
            feedback:
              "External messaging should be controlled and factual. Do not personalize the control.",
          },
        ],
      },
    ],
  },
  {
    id: "vendor-access",
    title: "Weekend Vendor Override",
    domain: "Third-Party Risk",
    risk: "Emergency access without review",
    actor: "Production Lead",
    timeLimit: 26,
    brief:
      "A vendor asks for privileged weekend access to restore a production system before customer impact grows.",
    artifact: {
      label: "Access Request",
      title: "Temporary admin access",
      body:
        "Vendor engineer requests shared admin credentials and file export rights for eight hours. No current access review found.",
    },
    steps: [
      {
        event:
          "The outage is real, but the vendor engineer is not listed in the latest approved support roster.",
        prompt: "Pick the access path.",
        choices: [
          {
            label: "Grant shared admin credentials and monitor afterward.",
            score: -26,
            control: -32,
            feedback:
              "Shared privileged access breaks accountability and exposes sensitive systems.",
          },
          {
            label: "Use emergency access with named user, scope limits, approval, and logging.",
            score: 32,
            control: 22,
            feedback:
              "Strong. Emergency process can move fast while preserving accountability.",
          },
          {
            label: "Deny all vendor involvement until Monday.",
            score: 4,
            control: 2,
            feedback:
              "Blocking may protect controls, but an emergency path exists for real incidents.",
          },
        ],
      },
      {
        event:
          "The vendor now asks to export logs that may include customer identifiers.",
        prompt: "What do you require?",
        choices: [
          {
            label: "Approve export to speed root-cause analysis.",
            score: -16,
            control: -16,
            feedback:
              "Data movement needs minimization, approval, and secure handling even during incidents.",
          },
          {
            label: "Limit logs, mask identifiers where possible, and use approved transfer.",
            score: 26,
            control: 18,
            feedback:
              "Good balance. You supported restoration without weakening data controls.",
          },
          {
            label: "Ask the vendor to confirm by chat that they will be careful.",
            score: -8,
            control: -10,
            feedback:
              "Informal assurance is not a substitute for scoped access and approved transfer.",
          },
        ],
      },
    ],
  },
];
