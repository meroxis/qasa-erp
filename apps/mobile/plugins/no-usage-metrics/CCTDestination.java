package com.google.android.datatransport.cct;

import com.google.android.datatransport.Encoding;
import com.google.android.datatransport.runtime.EncodedDestination;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.Set;

/**
 * Qasa ERP's own stand-in, written for the app (plugins/with-no-usage-metrics.js copies it into the native project).
 *
 * Google ML Kit, which reads barcodes on the phone, also reports how it is used through Google's data transport: it asks
 * for this class's INSTANCE and its encodings, and sends its reports there. The app leaves out Google's library of this
 * name (transport-backend-cct: the address and the code that sends) and has this one instead. It names a backend that no
 * part of the app provides and holds no address, so the data transport drops each report on the phone before storing it
 * ("backend not registered") and nothing is ever sent. Scanning is not affected.
 */
public final class CCTDestination implements EncodedDestination {
  /** A backend name no backend in the app answers to. */
  static final String DESTINATION_NAME = "qasa-none";

  private static final Set<Encoding> SUPPORTED_ENCODINGS =
      Collections.unmodifiableSet(new HashSet<>(Arrays.asList(Encoding.of("proto"), Encoding.of("json"))));

  /** What ML Kit asks for. */
  public static final CCTDestination INSTANCE = new CCTDestination();

  public static final CCTDestination LEGACY_INSTANCE = INSTANCE;

  private CCTDestination() {}

  @Override
  public String getName() {
    return DESTINATION_NAME;
  }

  /** No address and no key. */
  @Override
  public byte[] getExtras() {
    return null;
  }

  @Override
  public Set<Encoding> getSupportedEncodings() {
    return SUPPORTED_ENCODINGS;
  }
}
