Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

For Each arg In WScript.Arguments
  If LCase(arg) = "/delay" Then
    WScript.Sleep 30000
  End If
Next

root = fso.GetParentFolderName(WScript.ScriptFullName)
widgetFolder = fso.BuildPath(root, "desktop-widget")
launcher = fso.BuildPath(widgetFolder, "launch-widget-hidden.cmd")

shell.CurrentDirectory = widgetFolder
shell.Run """" & launcher & """", 0, False
