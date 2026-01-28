/**
 * Test script for scard.js
 */

import { establish_context, Card, SCOPE_USER, SHARE_SHARED, PROTOCOL_Tx, E_NO_SMARTCARD, STATE_PRESENT, E_TIMEOUT } from "./scard.js";

async function test() {
  try {
    console.log("Testing PC/SC smart card API...");

    // Establish context
    console.log("Establishing context...");
    const context = establish_context(SCOPE_USER);
    console.log("Context established successfully");

    // List readers
    console.log("Listing readers...");
    const readers = context.list_readers();
    const readersDisplay = readers.map((r) => (Buffer.isBuffer(r) ? r.toString("ascii").replace(/\0/g, "") : String(r)));
    console.log("Readers found:", readersDisplay);

    if (readers.length === 0) {
      console.log("No readers found. Please connect a smart card reader.");
      return;
    }

    // Wait for card insertion
    let current_state = context.get_status_change();
    while (!(current_state[0][1] & STATE_PRESENT)) {
      console.log("Insert a smartcard");
      current_state = context.get_status_change([[current_state[0][0], STATE_PRESENT]]);
    }
    console.log("Card present according to get_status_change.");

    console.log("Attempting to connect to first reader...");
    try {
      const reader_name = readers[0];
      const reader_display = Buffer.isBuffer(reader_name) ? reader_name.toString("ascii").replace(/\0/g, "") : String(reader_name);
      console.log(`Connecting to reader: ${reader_display}`);
      const card = new Card();
      card.connect(context, reader_name, SHARE_SHARED, PROTOCOL_Tx);
      console.log("Connected to card successfully");

      // Get ATR
      try {
        const atr = card.atr;
        console.log("ATR:", atr.toString("hex"));
      } catch (e) {
        console.log("Could not get ATR:", e.message);
      }

      // Try to transmit a basic APDU (GET CHALLENGE)
      try {
        const apdu = Buffer.from([0x00, 0x84, 0x00, 0x00, 0x20]);
        const response = card.transmit(apdu);
        console.log("APDU response:", response.toString("hex"));

        const status = card.status();
        console.log("Card status:", status);
      } catch (e) {
        console.log("Could not transmit APDU:", e.message);
      }

      // Disconnect
      card.disconnect();
      console.log("Card disconnected");
    } catch (e) {
      if (e.code === E_NO_SMARTCARD) {
        // SCARD_E_NO_SMARTCARD
        console.log("No smart card present in reader (this is expected if no card is inserted)");
      } else {
        console.log("Connection failed:", e.message);
        console.log("Error code:", e.code);
      }
    }

    // Release context
    context.release();
    console.log("Context released");

    console.log("Test completed successfully!");
  } catch (error) {
    console.error("Test failed:", error.message);
    console.error("Error code:", error.code);
  }
}

test();
