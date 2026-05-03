Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(WScript.ScriptFullName)
widgetFolder = fso.BuildPath(root, "desktop-widget")

shell.CurrentDirectory = widgetFolder
shell.Run "cmd.exe /c ""if not exist node_modules\electron (npm install) & npm start""", 0, False
