/// Script engine API documentation
/// <reference path="C:/Program Files/Leica Geosystems/Cyclone 3DR/Script/JsDoc/Reshaper.d.ts" />

/******** HOW TO USE IT ******
 * 
 * This script facilitates the classification of points within an LGSx project. 
 * 
 * Follow the steps below to use it:
 * 1) The user is prompted to choose an LGSx file. If a file is already loaded in the project, it will be automatically selected.
 * 2) The points from the selected LGSx file are imported and converted into the project. The script supports importing up to a maximum of 100 million points.
 * 3) The user is asked to select a classification model from the available options. Once a model is chosen, the classification process begins.
 * 4) After classification, it is possible to filter poits corresponding to certain classes
 * 5) After classification, a new LGSx file is created by cloning the original file and replacing the existing points with the newly classified ones.
 * 
 */ 

//
// Helper methods
//

/**
 * Print a step in the console
 */

let _counter=1;

function PrintStep(iMsg)
{
    print(`⚡[${_counter}] ${iMsg}...`);
    _counter++;
}

/**
 * Show a success message in the console
 */
function ShowSuccess(iMsg)
{
    var prefix = "✅ Success";
    print(`${prefix}: ${iMsg}`);
}

/**
 * Show an error message in the console
 */
function ShowError(iMsg)
{
    var title = "🛑 Error";
    print(`${title}: ${iMsg}`);
    SDialog.Message(iMsg, SDialog.Error, title);    
}

/**
 * Show a result + hide all other element
 */
function ShowResult(iComp)
{
    iComp.AddToDoc();
    ShowOnly([iComp]);
}

/**
 * Get the directory from a file path
 */
function GetDirectory(iFullPath)
{
    let dir = iFullPath.substring(0, iFullPath.lastIndexOf('/'));
    print(dir);
    return dir;
}

//
// Top level methods
//

/**
 * Load a LGSx file and convert it to a 3DR SDK cloud
 */
function LoadCloudFromLGSx()
{
    let cwCloud;
    let path = CurrentScriptPath();

    let allProj = SCwCloud.All();
    if(allProj.length > 0)
    {
        cwCloud = allProj[0];
    }
    else
    {
        let lgsxpath = GetOpenFileName("Select a LGSx file", "LGSx file (*.lgsx)");

        if (lgsxpath.length == 0) {
            ShowError("No file selected.");
            return;
        }

        let lgsxProject = SCwCloud.NewFromLGSxData(lgsxpath);
        if (lgsxProject.ErrorCode != 0) {
            ShowError(`The file couldn't be loaded at the following location: ${lgsxpath}`);
            return;
        }

        cwCloud = lgsxProject.CwCloud;
        path = GetDirectory(lgsxpath);
    }

    let conversion = cwCloud.ToCloud(100_000_000, false, true);
    let stdCloud = conversion.Cloud;

    return { LGSxCloud: cwCloud, StdCloud: stdCloud, LGSxPath: path};
}

/**
 * Select a classification model from the available ones
 */
function SelectedModel()
{
    let allModels = SCloud.GetClassificationModels();

    let selModelDialog = SDialog.New("Classification model");
    selModelDialog.BeginGroup("⚙️ Model Selection")
    selModelDialog.AddChoices({
        id: "selection",
        name: "Select a model:",
        choices: allModels,
        style: SDialog.ChoiceRepresentationMode.RadioButtons
    });

    let exec = selModelDialog.Run();

    if(exec.ErrorCode != 0)
    {
        ShowError("No model has been selected");
        return;
    }

    return allModels[exec.selection];
}

/**
 * * Classify an input cloud by a given model
 * @param {SCloud} iCloud
 * @param {string} iModelName
 */

function RunClassification(iCloud, iModelName)
{
    const modelList = SCloud.GetClassificationModels();
    let modelName = modelList.find(n => n == iModelName);
    
    if(modelName.length == 0)
    {
        ShowError(`Can't find model.`);
        return;
    }

    let retClassification = SCloud.Classify([iCloud], modelName);

    if(retClassification.ErrorCode != 0)
    {
        ShowError("Classification failed.");
        return;
    }

    var classifiedCloud = retClassification.CloudTbl[0];
    ShowResult(classifiedCloud);
    classifiedCloud.SetCloudRepresentation("classification");

    return classifiedCloud;
}

/**
 * Keep only selected classes from an input classify cloud
 * @param {iCloud} SCloud 
 */
function FilterClasses(iCloud)
{
    let classExplode = iCloud.ExplodeByClass();
    let classIds = classExplode.ClassTbl;

    let selClasses = SDialog.New("Class filtering");
    selClasses.BeginGroup("🔍 Select class to keep")
    for(const id of classIds)
    {
        let className = SCloud.GetClassName(id).Name;
        selClasses.AddBoolean({
            id: String(id),
            name: className,
            value: id!=0,
            saveValue: false
        });
    }

    let exec = selClasses.Run();
    if(exec.ErrorCode != 0)
    {
        ShowError("Dialog cancelled.");
        return;        
    }

    let idToKeep = [];
    for(const classId of classIds)
    {
        let id = String(classId);
        let classStatus = exec[id];
        if(classStatus == undefined)
            continue;

        if(classStatus)
            idToKeep.push(classId);
    }

    var cloudsToKeep = [];

    classExplode.ClassTbl.forEach((c, ii) => 
    {
        if(idToKeep.includes(c))
            cloudsToKeep.push(classExplode.CloudTbl[ii]);
    });

    if(cloudsToKeep.length == 0)
    {
        ShowError("Couldn't find relevant classes");
        return;
    }

    var mergedCloud = SCloud.Merge(cloudsToKeep).Cloud;
    ShowResult(mergedCloud);
    mergedCloud.SetCloudRepresentation("classification");
    
    return mergedCloud;
}

/**
 * Clone an original LGSx file with new points
 * @param {SCwCloud} iLGSxProject The original LGSx project loaded in the document
 * @param {SCloud} iCloud The point cloud representing the new points
 * @param {string} iLGSxPath The path to the original LGSx
 */
function DoClone(iLGSxProject, iCloud, iLGSxPath)
{
    PrintStep("Cloning a new LGSx file");

    // Ask for the output directory 
    let outputPath = GetSaveFileName("Pick a new filename", "LGSx file (*.lgsx)", iLGSxPath);
    if(outputPath.length == 0)
    {
        ShowError("Empty file path. Exiting the script.");
        return;
    }

    // Clone the original file
    let cloning = SCwCloud.CloneLGSx([iCloud], iLGSxProject, outputPath);

    if(cloning.ErrorCode != 0)
    {
        ShowError("Couldn't generate a new LGSx file."); 
        return;
    }    

    let outputDir = GetDirectory(outputPath);
    ShowSuccess(`File cloning succeeds at:\n${outputPath}`);
    OpenUrl(outputDir);
}

//
//  Main function
//

function Main()
{
    PrintStep("Selecting a LGSx project");
    let loadedData = LoadCloudFromLGSx();

    if(loadedData == undefined)
        return;

    PrintStep("Classification settings");
    let modelName = SelectedModel();
    if(modelName == undefined)
        return;

    PrintStep(`Classifying with model '${modelName}'`);
    let classifiedData = RunClassification(loadedData.StdCloud, modelName);
    if(classifiedData == undefined)
        return;

    // Optimize memory foot print
    loadedData.StdCloud.Clear();

    PrintStep("Class filtering");
    let editedCloud = FilterClasses(classifiedData);
    if(editedCloud == undefined)
        return;

    // Clone a new file
    DoClone(loadedData.LGSxCloud, editedCloud, loadedData.LGSxPath);
}

Main();