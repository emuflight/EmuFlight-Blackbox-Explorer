; ------------------------------------------
; Installer for EmuFlight Blackbox Viewer
; ------------------------------------------
; It receives from the command line with /D the parameters: 
; version
; archName
; archAllowed
; archInstallIn64bit
; sourceFolder
; targetFolder

#define ApplicationName "EmuFlight Blackbox Explorer"
#define CompanyName "The EmuFlight open source project"
#define CompanyUrl "https://github.com/emuflight/"
#define ExecutableFileName "emuflight-blackbox-explorer.exe"
#define GroupName "EmuFlight"
#define InstallerFileName "emuflight-blackbox-explorer-installer_" + version + "_" + archName
#define SourcePath "..\..\" + sourceFolder + "\EmuFlight-Blackbox-Explorer\" + archName
#define TargetFolderName "EmuFlight-Blackbox-Explorer"
#define UpdatesUrl "https://github.com/emuflight/EmuFlight-Blackbox-Explorer/releases"

[CustomMessages]
LaunchProgram=Start %1

[Files]
Source: "{#SourcePath}\*"; DestDir: "{app}"; Flags: recursesubdirs

[Icons]
; Programs group
Name: "{group}\{#ApplicationName}"; Filename: "{app}\{#ExecutableFileName}";
; Desktop icon
Name: "{autodesktop}\{#ApplicationName}"; Filename: "{app}\{#ExecutableFileName}"; 
; Non admin users, uninstall icon
Name: "{group}\Uninstall {#ApplicationName}"; Filename: "{uninstallexe}"; Check: not IsAdminInstallMode

[Registry]
; File associations
Root: HKA; Subkey: "Software\Classes\.bbl"; ValueType: string; ValueName: ""; ValueData: "EmuFlightBlackboxFile"; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\.bfl"; ValueType: string; ValueName: ""; ValueData: "EmuFlightBlackboxFile"; Flags: uninsdeletevalue
Root: HKA; Subkey: "Software\Classes\EmuFlightBlackboxFile"; ValueType: string; ValueName: ""; ValueData: "EmuFlight Blackbox Explorer log file"; Flags: uninsdeletekey
Root: HKA; Subkey: "Software\Classes\EmuFlightBlackboxFile\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\{#ExecutableFileName}"
Root: HKA; Subkey: "Software\Classes\EmuFlightBlackboxFile\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#ExecutableFileName}"" ""%1"""

; App registration
Root: HKA; Subkey: "Software\Classes\Applications\{#ExecutableFileName}"; ValueType: string; ValueName: "FriendlyAppName"; ValueData: "{#ApplicationName}"; Flags: uninsdeletekey

[Run]
; Add a checkbox to start the app after installed
Filename: {app}\{#ExecutableFileName}; Description: {cm:LaunchProgram, {#ApplicationName}}; Flags: nowait postinstall skipifsilent

[Setup]
AppId=610b3d74-ca89-4533-9490-128c40143493
AppName={#ApplicationName}
AppPublisher={#CompanyName}
AppPublisherURL={#CompanyUrl}
AppUpdatesURL={#UpdatesUrl}
AppVersion={#version}
ArchitecturesAllowed={#archAllowed}
ArchitecturesInstallIn64BitMode={#archInstallIn64bit}
ChangesAssociations=True
Compression=lzma2
DefaultDirName={autopf}\{#GroupName}\{#TargetFolderName}
DefaultGroupName={#GroupName}\{#ApplicationName}
LicenseFile=..\..\LICENSE
MinVersion=6.1
OutputBaseFilename={#InstallerFileName}
OutputDir=..\..\{#targetFolder}\
PrivilegesRequiredOverridesAllowed=commandline dialog
SetupIconFile=emu_installer_icon.ico
SolidCompression=yes
UninstallDisplayIcon={app}\{#ExecutableFileName}
UninstallDisplayName={#ApplicationName}
WizardImageFile=emu_installer.bmp
WizardSmallImageFile=emuf_installer_small.bmp
WizardStyle=modern

[Code]
function InitializeSetup(): Boolean;
var
    ResultCode: Integer;
    ResultStr: String;
    ParameterStr : String;
begin
    
    Result := True;

    // Check if the application is already installed by the old NSIS installer, and uninstall it
    // Look into the different registry entries: win32, win64 and without user rights
    if not RegQueryStringValue(HKLM, 'SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\EmuFlight Blackbox Explorer', 'UninstallString', ResultStr) then     
    begin
        if not RegQueryStringValue(HKLM, 'SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\EmuFlight Blackbox Explorer', 'UninstallString', ResultStr) then     
        begin
            RegQueryStringValue(HKCU, 'SOFTWARE\EmuFlight\EmuFlight Blackbox Explorer', 'UninstallString', ResultStr) 
        end;
    end;

    // Found, start uninstall
    if ResultStr <> '' then 
    begin
        
        ResultStr:=RemoveQuotes(ResultStr);

        // Add this parameter to not return until uninstall finished. The drawback is that the uninstaller file is not deleted
        ParameterStr := '_?=' + ExtractFilePath(ResultStr);

        if Exec(ResultStr, ParameterStr, '', SW_SHOW, ewWaitUntilTerminated, ResultCode) then
        begin
          // Delete the unistaller file and empty folders. Not deleting the files.
          DeleteFile(ResultStr);
          DelTree(ExtractFilePath(ResultStr), True, False, True);
        end
        else begin
            Result := False;
            MsgBox('Error uninstalling old Blackbox ' + SysErrorMessage(ResultCode) + '.', mbError, MB_OK);
        end;        
    end;    

end;