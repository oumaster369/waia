export const paymentAddressAuditActions = {
  walletCreated: "payment_address.wallet_created",
  addressGenerated: "payment_address.generated",
  addressReserved: "payment_address.reserved",
  addressReleased: "payment_address.released",
  addressAssigned: "payment_address.assigned",
  addressActivated: "payment_address.activated",
  addressRotated: "payment_address.rotated",
  addressRetired: "payment_address.retired",
  addressArchived: "payment_address.archived",
  addressRecovered: "payment_address.recovered",
} as const;

export type PaymentAddressAuditAction =
  (typeof paymentAddressAuditActions)[keyof typeof paymentAddressAuditActions];

export const paymentAddressEntityTypes = {
  paymentAddress: "payment_address",
  paymentAddressEvent: "payment_address_event",
  paymentWallet: "payment_wallet",
} as const;

export type PaymentAddressEntityType =
  (typeof paymentAddressEntityTypes)[keyof typeof paymentAddressEntityTypes];
