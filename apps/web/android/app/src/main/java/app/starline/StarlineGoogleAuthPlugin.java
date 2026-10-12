package app.starline;

import android.accounts.Account;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.GoogleAuthUtil;
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
        String webClientId = call.getString("webClientId");
        if (webClientId == null || webClientId.isEmpty()) {
            call.reject("webClientId is required");
            return;
        }
        GoogleSignInClient client = GoogleSignIn.getClient(getActivity(), signInOptions(webClientId));
        startActivityForResult(call, client.getSignInIntent(), "handleSignIn");
    }

    @ActivityCallback
    private void handleSignIn(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        GoogleSignInAccount account;
        try {
            account = GoogleSignIn.getSignedInAccountFromIntent(result.getData())
                    .getResult(ApiException.class);
        } catch (ApiException error) {
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

        new Thread(() -> {
            try {
                // Short-lived (about an hour) OAuth token for the scope the user just consented to;
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
            } catch (Exception error) {
                String message = error.getMessage() == null ? error.toString() : error.getMessage();
                getActivity().runOnUiThread(() -> call.reject("Drive authorization failed: " + message, error));
            }
        }).start();
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
