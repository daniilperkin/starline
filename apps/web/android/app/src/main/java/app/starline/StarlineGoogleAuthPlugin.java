package app.starline;

import android.accounts.Account;
import android.util.Log;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.GoogleAuthUtil;
import com.google.android.gms.auth.UserRecoverableAuthException;
import com.google.android.gms.auth.api.signin.GoogleSignIn;
import com.google.android.gms.auth.api.signin.GoogleSignInAccount;
import com.google.android.gms.auth.api.signin.GoogleSignInClient;
import com.google.android.gms.auth.api.signin.GoogleSignInOptions;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;

/**
 * Android sign-in for cloud backup (slice 15, decision 24).
 *
 * One flow, two tokens. The consent screen the user sees covers both `email` and the app's private
 * Drive folder (`drive.appdata`); the result is a Google ID token (who signed in) plus a Drive
 * access token (what may be written). Firebase is deliberately absent: it would have supplied only
 * the ID token, and Drive needs its own OAuth token anyway.
 *
 * Written in Java because this Android project has no Kotlin toolchain — adding one for a single
 * file is more moving parts than the file is worth.
 *
 * `GoogleAuthUtil.getToken` blocks on the network, so it runs on a worker thread and resolves the
 * plugin call back on the UI thread.
 */
@CapacitorPlugin(name = "StarlineGoogleAuth")
public class StarlineGoogleAuthPlugin extends Plugin {

    private static final String DRIVE_APPDATA_SCOPE = "https://www.googleapis.com/auth/drive.appdata";
    private static final String TAG = "StarlineGoogleAuth";

    private GoogleSignInOptions signInOptions(String webClientId) {
        GoogleSignInOptions.Builder builder = new GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN)
                .requestEmail()
                .requestScopes(new Scope(DRIVE_APPDATA_SCOPE));
        if (webClientId != null && !webClientId.isEmpty()) {
            builder.requestIdToken(webClientId);
        }
        return builder.build();
    }

    @PluginMethod
    public void signIn(PluginCall call) {
        Log.d(TAG, "signIn() called");
        String webClientId = call.getString("webClientId");
        if (webClientId == null || webClientId.isEmpty()) {
            call.reject("webClientId is required");
            return;
        }
        GoogleSignInClient client = GoogleSignIn.getClient(getActivity(), signInOptions(webClientId));
        try {
            android.content.Intent intent = client.getSignInIntent();
            Log.d(TAG, "launching sign-in intent");
            startActivityForResult(call, intent, "handleSignIn");
        } catch (Exception error) {
            Log.e(TAG, "could not build the sign-in intent", error);
            call.reject("could not build the sign-in intent: " + error.getMessage(), error);
        }
    }

    @ActivityCallback
    private void handleSignIn(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        Log.d(TAG, "handleSignIn() callback");
        GoogleSignInAccount account;
        try {
            account = GoogleSignIn.getSignedInAccountFromIntent(result.getData())
                    .getResult(ApiException.class);
        } catch (ApiException error) {
            Log.e(TAG, "sign-in failed with status " + error.getStatusCode(), error);
            // 12501 is the user dismissing the sheet, 12500 a misconfigured client (usually a
            // missing SHA fingerprint for the installed build).
            call.reject("Google sign-in failed (" + error.getStatusCode() + ")", error);
            return;
        }
        if (account == null) {
            call.reject("Google sign-in returned no account");
            return;
        }

        final Account raw = account.getAccount();
        if (raw == null) {
            call.reject("Google sign-in returned no underlying account");
            return;
        }

        fetchDriveToken(call, account, raw);
    }

    /**
     * Fetches the Drive token on a worker thread.
     *
     * The interesting case is UserRecoverableAuthException: Drive's app-data scope is one Google
     * wants the user to grant explicitly, and the first attempt after sign-in answers
     * "NeedRemoteConsent". That is not a failure — the exception carries the very screen that asks
     * for the grant, so it is launched and the token is fetched again once the user is back. Only
     * a second failure is reported as an error.
     */
    private void fetchDriveToken(PluginCall call, GoogleSignInAccount account, Account raw) {
        new Thread(() -> {
            try {
                // Short-lived (about an hour) OAuth token for the scope the user consented to;
                // Google caches it, so a refresh is cheap until it expires.
                String accessToken = GoogleAuthUtil.getToken(
                        getContext(), raw, "oauth2:" + DRIVE_APPDATA_SCOPE);
                if (accessToken == null) {
                    getActivity().runOnUiThread(() -> call.reject("Google returned no Drive access token"));
                    return;
                }
                JSObject ret = new JSObject();
                ret.put("idToken", account.getIdToken());
                ret.put("accessToken", accessToken);
                ret.put("email", account.getEmail());
                ret.put("subject", account.getId());
                getActivity().runOnUiThread(() -> call.resolve(ret));
            } catch (UserRecoverableAuthException recoverable) {
                Log.d(TAG, "Drive wants an explicit grant; launching Google's consent screen");
                android.content.Intent intent = recoverable.getIntent();
                if (intent == null) {
                    getActivity().runOnUiThread(() -> call.reject("Drive authorization needs consent but Google offered no screen for it", recoverable));
                    return;
                }
                getActivity().runOnUiThread(() -> startActivityForResult(call, intent, "handleTokenConsent"));
            } catch (Exception error) {
                String message = error.getMessage() == null ? error.toString() : error.getMessage();
                getActivity().runOnUiThread(() -> call.reject("Drive authorization failed: " + message, error));
            }
        }).start();
    }

    /** The user came back from Google's grant screen: fetch the token once more. */
    @ActivityCallback
    private void handleTokenConsent(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        Log.d(TAG, "handleTokenConsent() callback");
        GoogleSignInAccount account = GoogleSignIn.getLastSignedInAccount(getContext());
        if (account == null || account.getAccount() == null) {
            call.reject("not signed in");
            return;
        }
        fetchDriveToken(call, account, account.getAccount());
    }

    /** Re-reads the Drive token for the already-signed-in account (cheap while the grant lives). */
    @PluginMethod
    public void getAccessToken(PluginCall call) {
        GoogleSignInAccount account = GoogleSignIn.getLastSignedInAccount(getContext());
        if (account == null || account.getAccount() == null) {
            call.reject("not signed in");
            return;
        }
        final Account raw = account.getAccount();
        new Thread(() -> {
            try {
                String token = GoogleAuthUtil.getToken(
                        getContext(), raw, "oauth2:" + DRIVE_APPDATA_SCOPE);
                JSObject ret = new JSObject();
                ret.put("accessToken", token);
                getActivity().runOnUiThread(() -> call.resolve(ret));
            } catch (Exception error) {
                String message = error.getMessage() == null ? error.toString() : error.getMessage();
                getActivity().runOnUiThread(() -> call.reject("token refresh failed: " + message, error));
            }
        }).start();
    }

    /** Forgets the signed-in account on this device; the cloud files are untouched. */
    @PluginMethod
    public void signOut(PluginCall call) {
        GoogleSignInClient client = GoogleSignIn.getClient(
                getActivity(), new GoogleSignInOptions.Builder(GoogleSignInOptions.DEFAULT_SIGN_IN).build());
        client.signOut().addOnCompleteListener(task -> {
            JSObject ret = new JSObject();
            ret.put("signedOut", task.isSuccessful());
            call.resolve(ret);
        });
    }
}
