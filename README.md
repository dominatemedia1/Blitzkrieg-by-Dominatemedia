# Blitzkrieg by Dominate Media

Cloud-backed After Effects template library panel. Browse, import, stash, and manage AE compositions stored in the cloud — right from inside After Effects.

**Supported versions:** After Effects CC 2018 (v15.0) and later — Windows & macOS.

---

## Installation

### macOS

1. **Download or clone** this repository to your computer.

2. **Enable unsigned extensions** (required once). Open Terminal and run:
   ```bash
   defaults write com.adobe.CSXS.11 PlayerDebugMode 1
   ```
   > If you're on an older AE version, also run the same command for earlier CSXS versions:
   > ```bash
   > defaults write com.adobe.CSXS.10 PlayerDebugMode 1
   > defaults write com.adobe.CSXS.9 PlayerDebugMode 1
   > defaults write com.adobe.CSXS.8 PlayerDebugMode 1
   > ```

3. **Copy the extension** to the CEP extensions folder:
   ```bash
   cp -R /path/to/Blitzkrieg-by-Dominatemedia ~/Library/Application\ Support/Adobe/CEP/extensions/BlitzkriegDominateMedia
   ```
   Or create a **symlink** (easier for development — changes update instantly):
   ```bash
   ln -s /path/to/Blitzkrieg-by-Dominatemedia ~/Library/Application\ Support/Adobe/CEP/extensions/BlitzkriegDominateMedia
   ```
   Replace `/path/to/Blitzkrieg-by-Dominatemedia` with the actual path to the folder you downloaded.

4. **Restart After Effects.**

5. **Open the panel:** Go to **Window > Extensions > Blitzkrieg** in After Effects.

---

### Windows

1. **Download or clone** this repository to your computer.

2. **Enable unsigned extensions** (required once). Open the **Registry Editor** (`regedit`):
   - Navigate to `HKEY_CURRENT_USER\SOFTWARE\Adobe\CSXS.11`
     - If the `CSXS.11` key doesn't exist, create it.
   - Create a new **String Value** named `PlayerDebugMode` and set its data to `1`.
   > For older AE versions, do the same under `CSXS.10`, `CSXS.9`, and `CSXS.8`.

   **Or** run this in **Command Prompt (Admin)** or **PowerShell (Admin)**:
   ```powershell
   reg add HKCU\SOFTWARE\Adobe\CSXS.11 /v PlayerDebugMode /t REG_SZ /d 1 /f
   ```

3. **Copy the extension** to the CEP extensions folder:
   ```
   C:\Users\<YourUsername>\AppData\Roaming\Adobe\CEP\extensions\
   ```
   Copy the entire `Blitzkrieg-by-Dominatemedia` folder into that directory and rename it to `BlitzkriegDominateMedia`.

   The final path should be:
   ```
   C:\Users\<YourUsername>\AppData\Roaming\Adobe\CEP\extensions\BlitzkriegDominateMedia\
   ```
   Make sure `index.html` is directly inside that folder (not nested in a subfolder).

4. **Restart After Effects.**

5. **Open the panel:** Go to **Window > Extensions > Blitzkrieg** in After Effects.

---

## Troubleshooting

- **Panel doesn't appear in Window > Extensions:**
  - Make sure `PlayerDebugMode` is set to `1` for the correct CSXS version.
  - Verify the extension folder is in the right location and `index.html` is at the root level inside it.
  - Restart After Effects completely (quit and reopen, not just close the panel).

- **Panel shows a blank/white screen:**
  - Open the debug console: in your browser go to `http://localhost:8078` (or check **Help > Debug Extension** in AE) to see error messages.

- **"Extension could not be loaded" error:**
  - Double-check the folder structure — the `CSXS/manifest.xml` file must be present inside the extension folder.
  - Ensure your AE version is CC 2018 (v15.0) or later.

---

## Updating

To update to a new version:

1. **Pull the latest changes** (if using git) or download the new version.
2. **Replace** the contents of your extensions folder with the updated files.
3. **Restart After Effects.**

If you used a symlink on macOS, pulling the latest changes is all you need — no copy step required.
