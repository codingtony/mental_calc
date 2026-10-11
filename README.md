# Mental Calculation training for Kids (and Adults!)
Small console like game for practicing mental additions, substractions, multiplications and divisions for kids (grade 1 - 3).

The interface is minimal to reduce distractions. 
The highscores are stored locally in the local storage of the browser.

## Usage

The start page lets you choose the operations, the number of questions (1 to 500), the operand ranges (one slider each for addition, subtraction and multiplication/division, up to 20) and the time per question (1 to 10 seconds).
Each setting is initialized from the URL parameter if present and valid, otherwise from the last game played (local storage), otherwise from the default.

### Optional parameter : `n`

Number of questions, from 1 to 500. The default value is 50.

### Optional parameter : `m`

| mode | description | 
| - | ----- |
| 1 | Addition |
| 2 | Substraction |
| 3 | Addition and Substraction |
| 4 | Multiplication |
| 5 | Multiplication and Addition |
| 6 | Multiplication and Substraction |
| 7 | Multiplication, Addition and Substraction |
| 8 | Division |
| 9 | Division and Addition |
| 10 | Division and Substraction |
| 11 | Division, Addition and Substraction  |
| 12 | Division and Multiplication |
| 13 | Division, Multiplication and Addition |
| 14 | Division, Multiplication and Substraction |
| 15 (default) | Division, Multiplication, Addition and Substraction |

### Optional parameters : `maxAdd1`, `maxAdd2`, `maxSub1`, `maxSub2`, `maxMulDiv1`, `maxMulDiv2`

Controls the maximum operand values, up to 20 (minimum 1 for `maxAdd1`, `maxAdd2`, `maxSub1`; minimum 2 for `maxSub2`, `maxMulDiv1`, `maxMulDiv2`).
The default value is 10 for `maxAdd1`, `maxAdd2`.
The default value is 20 for `maxSub1`, `maxSub2` (from 2 - 1 to 20 - 19).
The default value is 10 for `maxMulDiv1`, `maxMulDiv2`.

Each start-page slider sets both bounds of its operation to the same value. If the two bounds differ (e.g. `maxMulDiv1=3&maxMulDiv2=10`), they are kept as passed until the slider is moved. The slider label shows them as `3/10`.

### Optional parameter : `t`

Number of seconds per question to have a success at the end, from 1 to 10.
The default value is 3

#### Divisions
The divisions are built using the `maxMulDiv1` and `maxMulDiv2` parameter indirectly. When building the question bank, the application construct divisions from multiplication. Example : with `2 x 3 = 6` the application construct the following divisions : `6 / 3 = 2` and `6 / 2 = 3`.

### Usage Examples :

Do only multiplications up to 3 : http://maths.codingtony.com/?m=4&maxMulDiv1=3

It will ask multiplications from 2 x 2 to 3 x 10