# Mental Calculation training for Kids (and Adults!)
Small console like game for practicing mental additions, substractions, multiplications and divisions for kids (grade 1 - 3).

The interface is minimal to reduce distractions. 
The highscores are stored locally in the local storage of the browser.

## Usage

### Optional parameter : `m`

| mode | description | 
| - | ----- |
| 1 | Addition |
| 2 | Substraction |
| 3 (default) | Addition and Substraction |
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
| 15 | Division, Multiplication, Addition and Substraction |

### Optional parameters : `maxAdd1`, `maxAdd2`, `maxSub1`, `maxSub2`, `maxMulDiv1`, `maxMulDiv2`

Controls the maximum operand values
The default value is 10 for `maxAdd1`, `maxAdd2`,`maxMulDiv1`, `maxMulDiv2`.
The default value is 20 for `maxSub1`, `maxSub2` (from 2 - 1 to 20 - 19).

#### Divisions
The divisions are built using the `maxMulDiv1` and `maxMulDiv2` parameter indirectly. When building the question bank, the application construct divisions from multiplication. Example : with `2 x 3 = 6` the application construct the following divisions : `6 / 3 = 2` and `6 / 2 = 3`.

### Usage Examples :

Do only multiplications up to 3 : http://maths.codingtony.com/?m=4&maxMulDiv1=3

It will ask multiplications from 2 x 2 to 3 x 10